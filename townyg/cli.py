#!/usr/bin/env python3
"""townyg: GTA-style maps of any town, generated from OpenStreetMap (Overpass) + Terrarium relief.

Usage:
    townyg                       # interactive full-screen wizard
    townyg "Černošín" [--area city|square] [--radius 2.5] [--max-size 18] [--styles all|gta5,sa,...] [--no-posters]

Creates ~/Townyg/mapy/<city>/ with the interactive map (index.html), data, and one poster per style.
Steps: geocode (Nominatim) -> download OSM (Overpass) -> project to local meters ->
classify (areas, roads, POIs, bus lines) -> hillshade from AWS Terrarium tiles -> write -> posters.
"""
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import argparse, base64, hashlib, io, json, math, os, re, select, shutil, subprocess, sys, time, unicodedata
import urllib.parse, urllib.request

_TTY = sys.stdout.isatty()
def _c(code): return f"\033[{code}m" if _TTY else ""
B, DIM, GRN, YEL, CYN, RED, RST = _c(1), _c(2), _c(32), _c(33), _c(36), _c(31), _c(0)


class Steps:
    """Prints a numbered, timed progress log ("postup")."""
    def __init__(self, total):
        self.total, self.n, self.t0, self.t = total, 0, time.time(), time.time()

    def start(self, title):
        self.n += 1
        self.t = time.time()
        print(f"\n{B}{CYN}[{self.n}/{self.total}]{RST} {B}{title}{RST}", flush=True)

    def info(self, msg):
        print(f"      {DIM}{msg}{RST}", flush=True)

    def inline(self, msg):
        if _TTY:
            print(f"\r      {DIM}{msg}{RST}\033[K", end="", flush=True)

    def done(self, msg=""):
        if _TTY:
            print("\r\033[K", end="")
        print(f"      {GRN}✓{RST} {msg} {DIM}({time.time() - self.t:.1f} s){RST}", flush=True)

    def warn(self, msg):
        print(f"      {YEL}!{RST} {msg}", flush=True)


LOG = Steps(9)

STYLES = {
    "gta5": "GTA V · Atlas", "radar": "GTA V · Radar (noc)", "sat": "GTA V · Satelit",
    "sa": "San Andreas", "gta4": "GTA IV", "vc": "Vice City",
}


def slugify(name):
    s = unicodedata.normalize("NFD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "mesto"

PKG = os.path.dirname(os.path.abspath(__file__))
VERSION = "0.1.0"
# user data (maps, poster runtime) lives outside the package, so it survives upgrades
HERE = os.path.abspath(os.path.expanduser(os.environ.get("TOWNYG_HOME") or "~/Townyg"))
os.makedirs(HERE, exist_ok=True)
UA = {"User-Agent": "townyg/%s (+https://github.com/metjum/townyg)" % "0.1.0"}


def http(url, data=None, timeout=180):
    req = urllib.request.Request(url, data=data, headers=UA)
    return urllib.request.urlopen(req, timeout=timeout).read()


# ---------------------------------------------------------------- geocode
def geocode(name):
    q = urllib.parse.urlencode({"q": name, "format": "json", "limit": 5, "countrycodes": "cz",
                                "addressdetails": 1, "polygon_geojson": 1})
    res = json.loads(http("https://nominatim.openstreetmap.org/search?" + q, timeout=30))
    if not res:
        sys.exit(f"Nothing found for {name!r}")
    # prefer real settlements over districts / regions
    def rank(r):
        t, c, at = r.get("type"), r.get("class"), r.get("addresstype")
        if c == "place" and t in ("city", "town", "village", "suburb", "hamlet", "municipality"):
            k = 0
        elif c == "boundary" and at in ("city", "town", "village", "municipality", "suburb", "hamlet"):
            k = 1
        else:
            k = 2
        return (k, -float(r["importance"]))
    res.sort(key=rank)
    # the best-ranked settlement is often a bare node; prefer a settlement result that carries a polygon
    r = next((x for x in res if rank(x)[0] < 2 and (x.get("geojson") or {}).get("type") in ("Polygon", "MultiPolygon")), res[0])
    return float(r["lat"]), float(r["lon"]), r


def dp_simplify(pts, tol):
    """Douglas-Peucker for an open polyline (iterative)."""
    n = len(pts)
    if n < 3:
        return list(pts)
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        ax, ay = pts[i]
        bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        ln = math.hypot(dx, dy) or 1e-9
        dmax, k = 0.0, -1
        for m in range(i + 1, j):
            d = abs(dx * (ay - pts[m][1]) - (ax - pts[m][0]) * dy) / ln
            if d > dmax:
                dmax, k = d, m
        if dmax > tol:
            keep[k] = True
            stack += [(i, k), (k, j)]
    return [p for p, kp in zip(pts, keep) if kp]


MARGIN = 150.0  # m added around the boundary bbox


def plan_area(lat, lon, geo, mode, radius_km, max_km):
    """Decide what to generate. Returns dict: P (Proj at bbox centre), half_w, half_h, boundary (flat rings|None), mode, km2."""
    ring_ll = []
    gj = geo.get("geojson") or {}
    if mode == "city":
        if gj.get("type") == "Polygon":
            polys = [gj["coordinates"]]
        elif gj.get("type") == "MultiPolygon":
            polys = gj["coordinates"]
        else:
            polys = []
        ring_ll = [[(c[1], c[0]) for c in p[0]] for p in polys if p and len(p[0]) >= 4]
    rings = None
    km2 = 0.0
    had_poly = bool(ring_ll)
    if ring_ll:
        la = [p[0] for r in ring_ll for p in r]
        lo = [p[1] for r in ring_ll for p in r]
        P = Proj((min(la) + max(la)) / 2, (min(lo) + max(lo)) / 2)
        for _ in range(2):  # re-centre so lat0/lon0 is the exact bbox centre in metres
            rr = [[P(a, b) for a, b in r] for r in ring_ll]
            xs = [p[0] for r in rr for p in r]
            ys = [p[1] for r in rr for p in r]
            cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            P = Proj(*P.inv(cx, cy))
        rr = [[P(a, b) for a, b in r] for r in ring_ll]
        xs = [p[0] for r in rr for p in r]
        ys = [p[1] for r in rr for p in r]
        raw_w, raw_h = max(xs) - min(xs), max(ys) - min(ys)
        half_w, half_h = raw_w / 2 + MARGIN, raw_h / 2 + MARGIN
        simp = []
        for r in rr:
            # closed ring: split at the vertex farthest from the start so DP has a real baseline
            m = max(range(len(r)), key=lambda q: math.dist(r[q], r[0]))
            r2 = dp_simplify(r[:m + 1], 4.0)[:-1] + dp_simplify(r[m:], 4.0)
            if r2[0] != r2[-1]:
                r2.append(r2[0])
            if len(r2) >= 4:
                simp.append(r2)
        big = [r for r in simp if abs(area(r)) >= 20000]
        if not big and simp:
            big = [max(simp, key=lambda r: abs(area(r)))]
        km2 = sum(abs(area(r)) for r in big) / 1e6
        if km2 < 0.1 or not big:
            LOG.warn("Nominatim vrátil nesmyslně malou hranici, používám čtverec 2,5 km")
            ring_ll = []
        else:
            rings = [[round(c, 1) for p in r for c in p] for r in big]
            LOG.info(f"obec: {raw_w / 1000:.1f} × {raw_h / 1000:.1f} km, ≈ {km2:.0f} km² "
                     f"({len(big)} {'část' if len(big) == 1 else 'částí'}, {sum(len(r) // 2 for r in rings)} bodů hranice)")
    if not ring_ll:
        if mode == "city" and not had_poly:
            LOG.warn("Nominatim nevrátil polygon hranice obce (jen bod), používám čtverec 2,5 km (--area square)")
        if mode == "city" or radius_km is None:
            radius_km = 2.5
        P = Proj(lat, lon)
        half_w = half_h = radius_km * 1000.0
        km2 = (2 * radius_km) ** 2
        mode = "square"
    cap = max_km * 500.0
    if 2 * max(half_w, half_h) > max_km * 1000:
        LOG.warn(f"město je {2 * half_w / 1000:.1f} × {2 * half_h / 1000:.1f} km, zkracuji na {max_km:g} km, "
                 f"zvyš pomocí --max-size")
        half_w, half_h = min(half_w, cap), min(half_h, cap)
    return {"P": P, "half_w": round(half_w, 1), "half_h": round(half_h, 1), "boundary": rings, "mode": mode,
            "km2": round(km2, 2)}


# ---------------------------------------------------------------- overpass
QUERY_VERSION = 3  # bump when the Overpass query parts change (invalidates caches)
TILE_M = 2000.0    # max tile side in metres
ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
             "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
PARALLEL = 4       # simultaneous tile downloads (each starts on a different mirror)
_LOCK = threading.Lock()
OVERPASS_PARTS = [
    "way[\"highway\"]", "way[\"railway\"]", "way[\"building\"]", "way[\"waterway\"]",
    "way[\"natural\"]", "relation[\"natural\"]", "way[\"landuse\"]", "relation[\"landuse\"]",
    "way[\"leisure\"]", "relation[\"leisure\"]", "way[\"amenity\"]", "way[\"historic\"]",
    "way[\"power\"=\"line\"]", "relation[\"building\"]", "relation[\"route\"=\"bus\"]", "way[\"shop\"]",
    "way[\"office\"]", "way[\"craft\"]", "way[\"healthcare\"]", "node[\"craft\"]", "node[\"healthcare\"]",
    "node[\"amenity\"]", "node[\"shop\"]", "node[\"tourism\"]", "node[\"historic\"]",
    "node[\"railway\"~\"station|halt\"]", "node[\"highway\"=\"bus_stop\"]", "node[\"place\"]",
    "node[\"leisure\"]", "node[\"natural\"~\"peak|spring|cave_entrance\"]",
    "node[\"man_made\"~\"tower|chimney|water_tower|mast\"]", "node[\"emergency\"]", "node[\"office\"]"]


def _fmt(n):
    return f"{n:,}".replace(",", " ")


def overpass_query(bb, start=0):
    """One Overpass request for bbox string 's,w,n,e': rotates through the mirrors, backs off between rounds."""
    q = "[out:json][timeout:90];(" + "".join(f"{p}({bb});" for p in OVERPASS_PARTS) + ");out geom;"
    body = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(5):
        for k in range(len(ENDPOINTS)):
            ep = ENDPOINTS[(start + k) % len(ENDPOINTS)]
            try:
                d = http(ep, body, timeout=110)
                j = json.loads(d)
                if "elements" not in j or "error" in (j.get("remark") or "").lower():
                    raise RuntimeError(j.get("remark") or "prázdná odpověď")
                return j
            except Exception as ex:  # noqa
                last = ex
                with _LOCK:
                    LOG.warn(f"{ep.split('/')[2]}: {str(ex)[:60]}")
                time.sleep(2)
        time.sleep(15 * (attempt + 1))
    raise RuntimeError(f"Overpass nedostupný: {last}")


def _fresh(path, days=7):
    return os.path.exists(path) and time.time() - os.path.getmtime(path) < 86400 * days


def _bbox_close(P, a, b, tol=30.0):
    """a, b = [s, w, n, e]; True when all edges differ by < tol metres."""
    return (abs(a[0] - b[0]) * P.ky < tol and abs(a[2] - b[2]) * P.ky < tol and
            abs(a[1] - b[1]) * P.kx < tol and abs(a[3] - b[3]) * P.kx < tol)


def fetch_osm(P, half_w, half_h, outdir):
    """Download OSM data for the rectangle in tiles <= TILE_M, cache tiles + merged result."""
    cache = os.path.join(outdir, "osm.json")
    s, w = P.inv(-half_w, -half_h)
    n, e = P.inv(half_w, half_h)
    bbox = [round(s, 5), round(w, 5), round(n, 5), round(e, 5)]
    if _fresh(cache):
        try:
            j = json.load(open(cache))
            if j.get("_qv") == QUERY_VERSION and j.get("_bbox") and _bbox_close(P, j["_bbox"], bbox):
                LOG.info(f"používám cache {os.path.relpath(cache)} (méně než 7 dní stará)")
                return j, 0
            LOG.info("cache je ze starší verze dotazu nebo jiné oblasti, stahuji znovu")
        except Exception:  # noqa
            pass
    nx, ny = max(1, math.ceil(2 * half_w / TILE_M)), max(1, math.ceil(2 * half_h / TILE_M))
    tdir = os.path.join(outdir, "tiles")
    os.makedirs(tdir, exist_ok=True)
    total = nx * ny
    LOG.info(f"oblast {2 * half_w / 1000:.1f} × {2 * half_h / 1000:.1f} km → {total} dlaždic ({nx} × {ny})")
    specs = []
    for j_ in range(ny):
        for i in range(nx):
            x0, x1 = -half_w + 2 * half_w * i / nx, -half_w + 2 * half_w * (i + 1) / nx
            y0, y1 = -half_h + 2 * half_h * j_ / ny, -half_h + 2 * half_h * (j_ + 1) / ny
            ts, tw = P.inv(x0, y0)
            tn, te = P.inv(x1, y1)
            bb = f"{ts:.5f},{tw:.5f},{tn:.5f},{te:.5f}"
            h = hashlib.md5(bb.encode()).hexdigest()[:8]
            specs.append({"k": len(specs), "bb": bb, "file": os.path.join(tdir, f"{QUERY_VERSION}_{i}_{j_}_{h}.json")})
    cached = 0
    for sp in specs:
        sp["tj"] = None
        if _fresh(sp["file"]):
            try:
                sp["tj"] = json.load(open(sp["file"]))
                cached += 1
            except Exception:  # noqa
                sp["tj"] = None
    if cached:
        LOG.info(f"{cached}/{total} dlaždic už je v cache")
    todo = [sp for sp in specs if sp["tj"] is None]
    done = [0]

    def work(sp):
        tj = overpass_query(sp["bb"], start=sp["k"])
        tmp = sp["file"] + ".part"
        json.dump(tj, open(tmp, "w"))
        os.replace(tmp, sp["file"])
        return sp, tj

    if todo:
        LOG.info(f"stahuji {len(todo)} dlaždic, {min(PARALLEL, len(todo))} souběžně přes {len(ENDPOINTS)} zrcadel Overpassu")
        t_start = time.time()
        with ThreadPoolExecutor(max_workers=min(PARALLEL, len(todo))) as ex:
            futs = [ex.submit(work, sp) for sp in todo]
            try:
                for f in as_completed(futs):
                    sp, tj = f.result()
                    sp["tj"] = tj
                    done[0] += 1
                    el = time.time() - t_start
                    eta = el / done[0] * (len(todo) - done[0])
                    with _LOCK:
                        LOG.info(f"dlaždice {done[0]}/{len(todo)} hotová · {_fmt(len(tj['elements']))} prvků · zbývá ≈ {eta / 60:.0f} min")
            except BaseException:
                for f in futs:
                    f.cancel()
                raise
    elements, seen = [], set()
    for sp in specs:
        for el in sp["tj"]["elements"]:
            key = (el["type"], el["id"])
            if key not in seen:
                seen.add(key)
                elements.append(el)
        sp["tj"] = None
    LOG.info(f"celkem {_fmt(len(elements))} unikátních prvků")
    j = {"elements": elements, "_qv": QUERY_VERSION, "_bbox": bbox}
    json.dump(j, open(cache, "w"))
    return j, total


# ---------------------------------------------------------------- geometry helpers
class Proj:
    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = lat0, lon0
        self.kx = 111320.0 * math.cos(math.radians(lat0))
        self.ky = 110574.0

    def __call__(self, lat, lon):
        return round((lon - self.lon0) * self.kx, 1), round((lat - self.lat0) * self.ky, 1)

    def inv(self, x, y):
        return self.lat0 + y / self.ky, self.lon0 + x / self.kx


def pts(geom, P):
    out, last = [], None
    for g in geom:
        p = P(g["lat"], g["lon"])
        if p != last:
            out.append(p)
        last = p
    return out


def join_rings(segs):
    """Join way fragments (lists of (lat,lon) keys) into closed rings."""
    segs = [list(s) for s in segs if len(s) >= 2]
    rings = []
    while segs:
        cur = segs.pop()
        while cur[0] != cur[-1]:
            for i, s in enumerate(segs):
                if s[0] == cur[-1]:
                    cur += s[1:]
                elif s[-1] == cur[-1]:
                    cur += s[::-1][1:]
                elif s[-1] == cur[0]:
                    cur = s + cur[1:]
                elif s[0] == cur[0]:
                    cur = s[::-1] + cur[1:]
                else:
                    continue
                segs.pop(i)
                break
            else:
                break
        if cur[0] == cur[-1] and len(cur) >= 4:
            rings.append(cur)
    return rings


def area(ring):
    return sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1] for i in range(len(ring) - 1)) / 2


def simplify(ring, tol=0.35):
    """Drop nearly collinear vertices (keeps rings closed)."""
    if len(ring) < 6:
        return ring
    out = [ring[0]]
    for i in range(1, len(ring) - 1):
        a, b, c = out[-1], ring[i], ring[i + 1]
        d = abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / (math.hypot(c[0] - a[0], c[1] - a[1]) or 1)
        if d > tol:
            out.append(b)
    out.append(ring[-1])
    return out if len(out) >= 4 else ring


def flat(polys):
    return [[c for p in r for c in p] for r in polys]


# ---------------------------------------------------------------- classification
AREA_LANDUSE = {
    "forest": "forest", "meadow": "grass", "grass": "grass", "village_green": "grass",
    "farmland": "farm", "farmyard": "farm", "orchard": "orchard", "vineyard": "orchard",
    "residential": "town", "commercial": "town", "retail": "town", "construction": "town",
    "industrial": "industrial", "garages": "industrial", "railway": "industrial", "brownfield": "industrial",
    "cemetery": "cemetery", "allotments": "park", "recreation_ground": "sport", "quarry": "quarry",
    "basin": "water", "reservoir": "water", "greenfield": "grass", "flowerbed": "park",
}
AREA_NATURAL = {"wood": "forest", "scrub": "scrub", "heath": "scrub", "grassland": "grass", "wetland": "wetland",
                "water": "water", "bare_rock": "rock", "scree": "rock", "fell": "grass"}
AREA_LEISURE = {"park": "park", "garden": "park", "playground": "sport", "pitch": "sport", "sports_centre": "sport",
                "stadium": "sport", "golf_course": "sport", "swimming_pool": "water", "common": "park",
                "dog_park": "park", "track": "sport"}
AREA_ORDER = ["farm", "grass", "orchard", "scrub", "wetland", "forest", "town", "industrial", "quarry", "rock",
              "park", "cemetery", "sport", "parking", "water"]

ROAD_CLASS = {
    "motorway": "major", "motorway_link": "major", "trunk": "major", "trunk_link": "major",
    "primary": "major", "primary_link": "major", "secondary": "second", "secondary_link": "second",
    "tertiary": "tert", "tertiary_link": "tert", "unclassified": "tert",
    "residential": "minor", "living_street": "minor", "road": "minor", "service": "service",
    "track": "track", "path": "path", "footway": "path", "cycleway": "path", "bridleway": "path",
    "steps": "path", "pedestrian": "path", "corridor": "path",
}

POI_MAP = [  # (predicate tags -> kind)
    (lambda t: t.get("amenity") == "townhall", "radnice"),
    (lambda t: t.get("amenity") in ("police",), "policie"),
    (lambda t: t.get("amenity") in ("fire_station",), "hasici"),
    (lambda t: t.get("amenity") in ("hospital", "clinic", "doctors", "dentist", "veterinary") or t.get("healthcare"), "zdravi"),
    (lambda t: t.get("amenity") in ("pharmacy",), "lekarna"),
    (lambda t: t.get("amenity") in ("school", "kindergarten", "college", "university"), "skola"),
    (lambda t: t.get("amenity") in ("library",), "knihovna"),
    (lambda t: t.get("amenity") == "post_office", "posta"),
    (lambda t: t.get("amenity") in ("bank", "atm"), "banka"),
    (lambda t: t.get("amenity") == "fuel", "benzina"),
    (lambda t: t.get("amenity") in ("restaurant", "fast_food", "cafe", "pub", "bar", "biergarten"), "jidlo"),
    (lambda t: t.get("shop"), "obchod"),
    (lambda t: t.get("office"), "kancelar"),
    (lambda t: t.get("craft"), "remeslo"),
    (lambda t: t.get("amenity") == "place_of_worship", "kostel"),
    (lambda t: t.get("historic") in ("castle", "ruins", "fort", "manor", "archaeological_site"), "zricenina"),
    (lambda t: t.get("tourism") in ("viewpoint",), "vyhlidka"),
    (lambda t: t.get("tourism") in ("hotel", "guest_house", "hostel", "motel", "apartment", "camp_site", "chalet"), "ubytovani"),
    (lambda t: t.get("tourism") in ("museum", "gallery") or t.get("historic") in ("monument",), "muzeum"),
    (lambda t: t.get("tourism") == "attraction" or t.get("tourism") == "picnic_site", "zajimavost"),
    (lambda t: t.get("historic") in ("memorial", "wayside_cross", "wayside_shrine"), "pamatka"),
    (lambda t: t.get("leisure") in ("pitch", "sports_centre", "stadium", "swimming_pool", "playground"), "sport"),
    (lambda t: t.get("natural") == "peak", "vrchol"),
    (lambda t: t.get("railway") in ("station", "halt"), "vlak"),
    (lambda t: t.get("highway") == "bus_stop", "bus"),
    (lambda t: t.get("amenity") == "parcel_locker", None),
]
# kinds that need a name to be shown (otherwise just noise on the map)
NAME_REQUIRED = {"zajimavost", "pamatka", "sport", "zricenina", "vyhlidka", "obchod", "ubytovani", "kancelar", "remeslo"}


def poi_kind(t):
    for pred, k in POI_MAP:
        if pred(t):
            return k
    return None


def centroid(ring):
    n = len(ring) - 1
    return sum(p[0] for p in ring[:n]) / n, sum(p[1] for p in ring[:n]) / n


BUILD_CS = {"house": "Rodinný dům", "detached": "Rodinný dům", "residential": "Obytná budova", "apartments": "Bytový dům",
            "terrace": "Řadový dům", "church": "Kostel", "chapel": "Kaple", "garage": "Garáž", "garages": "Garáže",
            "industrial": "Průmyslová budova", "warehouse": "Sklad", "barn": "Stodola", "farm_auxiliary": "Hospodářská stavba",
            "farm": "Statek", "school": "Škola", "public": "Veřejná budova", "civic": "Veřejná budova", "commercial": "Komerční budova",
            "retail": "Obchod", "hotel": "Hotel", "shed": "Kůlna", "roof": "Přístřešek", "service": "Technická budova",
            "kindergarten": "Školka", "hospital": "Nemocnice", "cabin": "Chata", "static_caravan": "Maringotka",
            "greenhouse": "Skleník", "ruins": "Zřícenina", "yes": "Budova"}


def building_height(t):
    for k in ("height", "building:height"):
        v = t.get(k, "").replace("m", "").strip()
        try:
            return max(2.5, float(v))
        except ValueError:
            pass
    try:
        return max(3.0, float(t.get("building:levels", "")) * 3.1 + 1.5)
    except ValueError:
        pass
    b = t.get("building", "yes")
    return {"church": 16, "chapel": 7, "cathedral": 30, "industrial": 8, "warehouse": 8, "apartments": 13,
            "garage": 3, "garages": 3, "shed": 2.8, "roof": 3.5, "farm_auxiliary": 5, "barn": 7, "civic": 9,
            "school": 9, "public": 9, "hotel": 11, "commercial": 8, "retail": 6, "house": 6.5,
            "detached": 6.5, "terrace": 7, "residential": 7}.get(b, 6)


# ---------------------------------------------------------------- relief
def build_relief(P, half_w, half_h, step=4.0, z=None):
    """Hillshade + elevation grid from Terrarium tiles. Returns (png_data_uri, w, h, step, hmin, hmax, sampler)."""
    import numpy as np
    from PIL import Image

    if z is None:  # z13 (~12 m/px) is enough for big areas and halves the downloads
        z = 14 if max(half_w, half_h) <= 4500 else 13
    lat_n, lon_w = P.inv(-half_w - 300, half_h + 300)
    lat_s, lon_e = P.inv(half_w + 300, -half_h - 300)

    def tile(lat, lon):
        n = 2 ** z
        x = (lon + 180) / 360 * n
        y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
        return x, y

    x0, y0 = tile(lat_n, lon_w)
    x1, y1 = tile(lat_s, lon_e)
    tx0, tx1, ty0, ty1 = int(x0), int(x1), int(y0), int(y1)
    mosaic = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256), dtype=np.float32)
    total_t, cnt = (ty1 - ty0 + 1) * (tx1 - tx0 + 1), 0
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            cnt += 1
            LOG.inline(f"dlaždice terénu {cnt}/{total_t}")
            url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{tx}/{ty}.png"
            im = Image.open(io.BytesIO(http(url, timeout=60))).convert("RGB")
            a = np.asarray(im, dtype=np.float32)
            mosaic[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = \
                a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768

    # resample into local-meter grid (x east, y north) with bilinear interpolation
    gw, gh = int(2 * half_w / step) + 1, int(2 * half_h / step) + 1
    xs = (np.arange(gw, dtype=np.float64) * step - half_w)
    ys = (half_h - np.arange(gh, dtype=np.float64) * step)  # row 0 = north
    lon = P.lon0 + xs / P.kx
    lat = P.lat0 + ys / P.ky
    n = 2 ** z
    px = ((lon + 180) / 360 * n - tx0) * 256
    py = ((1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * n - ty0) * 256
    PX, PY = np.meshgrid(px.astype(np.float32), py.astype(np.float32))  # float32: 18x18 km stays small
    ix, iy = np.clip(PX.astype(int), 0, mosaic.shape[1] - 2), np.clip(PY.astype(int), 0, mosaic.shape[0] - 2)
    fx, fy = PX - ix, PY - iy
    h = (mosaic[iy, ix] * (1 - fx) * (1 - fy) + mosaic[iy, ix + 1] * fx * (1 - fy) +
         mosaic[iy + 1, ix] * (1 - fx) * fy + mosaic[iy + 1, ix + 1] * fx * fy).astype(np.float32)
    del PX, PY, ix, iy, fx, fy
    # smooth a little (Terrarium z14 is ~6 m/px, terraced)
    k = np.array([1, 4, 6, 4, 1], dtype=np.float32) / 16
    for ax in (0, 1):
        h = np.apply_along_axis(lambda v: np.convolve(np.pad(v, 2, mode="edge"), k, mode="valid"), ax, h)

    h = h.astype(np.float32)
    dzdy, dzdx = np.gradient(h, step)  # rows go south, so dzdy is d/d(south)
    dzdy = -dzdy  # d/d(north)
    ex = 2.2  # vertical exaggeration
    az, alt = math.radians(315), math.radians(42)
    nx, ny, nz = -ex * dzdx, -ex * dzdy, np.ones_like(h)
    ln = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    lx, ly, lz = math.cos(alt) * math.sin(az), math.cos(alt) * math.cos(az), math.sin(alt)
    shade = (nx * lx + ny * ly + nz * lz) / ln
    flat_v = lz
    img = np.clip(128 + (shade - flat_v) * 330, 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(img, "L").save(buf, "PNG", optimize=True)
    uri = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    # coarse elevation grid (every 8th sample) for peaks / elevation readout
    sub = 6
    hs = h[::sub, ::sub]
    return {"img": uri, "w": gw, "h": gh, "step": step, "x0": -half_w, "y0": half_h,
            "hmin": float(h.min()), "hmax": float(h.max()),
            "hgrid": {"step": step * sub, "w": hs.shape[1], "h": hs.shape[0],
                      "v": [round(float(v), 1) for v in hs.ravel()]}}


# ---------------------------------------------------------------- main


def process(els, P, half_w, half_h):
    """OSM elements -> dict of map layers (local metres)."""
    areas = {k: [] for k in AREA_ORDER}
    area_names, buildings, roads, rails, waters, cliffs, treerows, powerl = [], [], [], [], [], [], [], []
    pois, places, peaks, reserves, busroutes = [], [], [], [], []
    seen = set()

    def area_class(t):
        if t.get("landuse") in AREA_LANDUSE:
            return AREA_LANDUSE[t["landuse"]]
        if t.get("natural") in AREA_NATURAL:
            return AREA_NATURAL[t["natural"]]
        if t.get("leisure") in AREA_LEISURE:
            return AREA_LEISURE[t["leisure"]]
        if t.get("amenity") == "parking":
            return "parking"
        if t.get("amenity") == "grave_yard":
            return "cemetery"
        if t.get("amenity") in ("school", "kindergarten", "hospital", "college"):
            return "town"
        return None

    def add_poi(t, x, y, force=None):
        kind = force or poi_kind(t)
        if not kind:
            return
        name = t.get("name") or t.get("brand") or ""
        if kind in NAME_REQUIRED and not name:
            return
        key = (kind, name, round(x / 40), round(y / 40))
        key2 = (name, kind) if name else None
        if key in seen or (key2 and key2 in seen and kind in ("zajimavost", "pamatka")):
            return
        seen.add(key)
        if key2:
            seen.add(key2)
        p = {"k": kind, "x": x, "y": y}
        if name:
            p["n"] = name
        for src, dst in (("ele", "e"), ("opening_hours", "oh"), ("website", "w"), ("denomination", "d")):
            if t.get(src):
                p[dst] = t[src]
        if t.get("addr:street") or t.get("addr:housenumber"):
            p["a"] = (t.get("addr:street", t.get("addr:place", "")) + " " + t.get("addr:housenumber", "")).strip()
        pois.append(p)

    def line(g):
        return [v for pt in g for v in pt]

    for el in els:
        t = el.get("tags", {})
        typ = el["type"]
        if typ == "node":
            x, y = P(el["lat"], el["lon"])
            if t.get("name") and t.get("place") in ("city", "town", "village", "hamlet", "locality", "suburb", "quarter", "borough", "neighbourhood", "isolated_dwelling"):
                places.append({"n": t["name"], "t": t["place"], "x": x, "y": y})
            elif t.get("natural") == "peak" and t.get("name"):
                peaks.append({"n": t["name"], "x": x, "y": y, "e": t.get("ele", "")})
            else:
                add_poi(t, x, y)
            continue

        if typ == "way":
            g = pts(el.get("geometry", []), P)
            if len(g) < 2:
                continue
            closed = el["geometry"][0] == el["geometry"][-1] and len(g) >= 4
            if "building" in t and closed:
                ring = simplify(g)
                if area(ring) < 0:
                    ring = ring[::-1]
                b = {"p": line(ring), "h": round(building_height(t), 1), "t": BUILD_CS.get(t["building"], "Budova")}
                if t["building"] in ("church", "chapel", "cathedral") or t.get("amenity") == "place_of_worship":
                    b["c"] = 1
                if t.get("name"):
                    b["n"] = t["name"]
                if t.get("addr:housenumber") or t.get("addr:street"):
                    b["a"] = ((t.get("addr:street") or t.get("addr:place") or "") + " " + t.get("addr:housenumber", "")).strip()
                if t.get("building:levels"):
                    b["l"] = t["building:levels"]
                buildings.append(b)
                if t.get("amenity") or t.get("historic") or t.get("tourism") or t.get("shop") or t.get("office") or t.get("craft") or t.get("healthcare"):
                    cx, cy = centroid(ring)
                    add_poi(t, round(cx, 1), round(cy, 1))
                continue
            if "highway" in t and t["highway"] in ROAD_CLASS:
                c = ROAD_CLASS[t["highway"]]
                if t.get("area") == "yes" and closed:
                    if t["highway"] in ("pedestrian", "footway", "service"):
                        areas["parking"].append({"p": [line(g)]})
                    continue
                r = {"c": c, "p": line(g)}
                if t.get("name"):
                    r["n"] = t["name"]
                if t.get("bridge") and t["bridge"] != "no":
                    r["b"] = 1
                if t.get("tunnel") and t["tunnel"] != "no":
                    r["t"] = 1
                if t.get("oneway") in ("yes", "1"):
                    r["o"] = 1
                if t.get("ref"):
                    r["r"] = t["ref"]
                if t.get("access") in ("private", "no") or t.get("motor_vehicle") in ("no", "private"):
                    r["x"] = 1
                roads.append(r)
                continue
            if "railway" in t:
                if t["railway"] in ("rail", "light_rail", "narrow_gauge", "disused", "abandoned", "tram"):
                    rails.append({"p": line(g), "d": 1 if t["railway"] in ("disused", "abandoned") else 0})
                continue
            if "waterway" in t:
                if t["waterway"] in ("river", "stream", "canal", "ditch", "drain"):
                    wd = {"river": 9, "canal": 5, "stream": 2.4, "ditch": 1.2, "drain": 1.2}[t["waterway"]]
                    waters.append({"p": line(g), "w": wd, "n": t.get("name", "")})
                continue
            if t.get("natural") == "cliff":
                cliffs.append({"p": line(g)})
                continue
            if t.get("natural") == "tree_row":
                treerows.append({"p": line(g)})
                continue
            if t.get("power") == "line":
                powerl.append({"p": line(g)})
                continue
            if closed and (t.get("shop") or t.get("office") or t.get("craft") or t.get("healthcare")):
                cx, cy = centroid(g)
                add_poi(t, round(cx, 1), round(cy, 1))
            cls = area_class(t)
            if cls and closed:
                ring = simplify(g)
                areas[cls].append({"p": [line(ring)]})
                if t.get("name") and cls in ("water", "town", "park", "sport", "forest"):
                    cx, cy = centroid(ring)
                    area_names.append({"n": t["name"], "c": cls, "x": round(cx, 1), "y": round(cy, 1), "a": round(abs(area(ring)))})
                if t.get("amenity") == "place_of_worship" or t.get("historic") == "castle":
                    cx, cy = centroid(ring)
                    add_poi(t, round(cx, 1), round(cy, 1))
            elif closed and t.get("historic") in ("castle", "ruins", "fort"):
                cx, cy = centroid(g)
                add_poi(t, round(cx, 1), round(cy, 1), force="zricenina")
            continue

        if typ == "relation":
            members = el.get("members", [])
            if t.get("route") == "bus":
                # real bus line: join member ways in order, keep the longest part inside the map
                path, stops = [], []
                for m in members:
                    if m.get("type") == "way" and m.get("geometry"):
                        seg = [P(g["lat"], g["lon"]) for g in m["geometry"]]
                        if path and math.dist(path[-1], seg[0]) > math.dist(path[-1], seg[-1]):
                            seg = seg[::-1]
                        path += seg if not path or path[-1] != seg[0] else seg[1:]
                    elif m.get("type") == "node" and m.get("role", "").startswith(("stop", "platform")) and "lat" in m:
                        x, y = P(m["lat"], m["lon"])
                        stops.append({"x": x, "y": y})
                limx, limy, runs, cur = half_w + 200, half_h + 200, [], []
                for p in path:
                    if abs(p[0]) <= limx and abs(p[1]) <= limy:
                        cur.append(p)
                    else:
                        if cur:
                            runs.append(cur)
                        cur = []
                if cur:
                    runs.append(cur)
                if runs:
                    best = max(runs, key=len)
                    if len(best) >= 2:
                        busroutes.append({"ref": t.get("ref", ""), "n": t.get("name", ""), "p": line(best),
                                          "stops": [s for s in stops if abs(s["x"]) <= limx and abs(s["y"]) <= limy]})
                continue
            outers, inners = [], []
            for m in members:
                if m.get("type") != "way" or not m.get("geometry"):
                    continue
                key = [(round(g["lat"], 7), round(g["lon"], 7)) for g in m["geometry"]]
                (inners if m.get("role") == "inner" else outers).append(key)
            orings, irings = join_rings(outers), join_rings(inners)
            if "building" in t:
                for r in orings:
                    ring = simplify([P(la, lo) for la, lo in r])
                    if area(ring) < 0:
                        ring = ring[::-1]
                    buildings.append({"p": line(ring), "h": round(building_height(t), 1), "t": BUILD_CS.get(t["building"], "Budova")})
                continue
            if t.get("leisure") == "nature_reserve" or t.get("boundary") == "protected_area":
                for r in orings:
                    reserves.append({"p": line([P(la, lo) for la, lo in r]), "n": t.get("name", "")})
                continue
            cls = area_class(t)
            if not cls:
                continue
            polys = [line(simplify([P(la, lo) for la, lo in r])) for r in orings]
            holes = [line(simplify([P(la, lo) for la, lo in r])) for r in irings]
            if polys:
                areas[cls].append({"p": polys + holes})
                if t.get("name") and cls in ("water", "forest"):
                    r0 = [P(la, lo) for la, lo in orings[0]]
                    cx, cy = centroid(r0)
                    area_names.append({"n": t["name"], "c": cls, "x": round(cx, 1), "y": round(cy, 1), "a": round(abs(area(r0)))})

    return {"areas": {k: v for k, v in areas.items() if v}, "areaOrder": [k for k in AREA_ORDER if areas[k]],
            "buildings": buildings, "roads": roads, "rails": rails, "waters": waters, "cliffs": cliffs,
            "treerows": treerows, "power": powerl, "pois": pois, "places": places, "peaks": peaks,
            "areaNames": area_names, "reserves": reserves, "busRoutes": busroutes}


def ensure_runtime():
    """Poster rendering needs headless Chromium. Installed once into ~/Townyg/.runtime (needs node + npm)."""
    rt = os.path.join(HERE, ".runtime")
    if os.path.isdir(os.path.join(rt, "node_modules", "playwright")) and os.path.exists(os.path.join(rt, ".ready")):
        return rt
    npm = shutil.which("npm")
    if not npm:
        LOG.warn("chybí node/npm (brew install node), plakáty přeskakuji")
        return None
    os.makedirs(rt, exist_ok=True)
    shutil.copy(os.path.join(PKG, "node", "package.json"), os.path.join(rt, "package.json"))
    LOG.info("první spuštění: instaluji Chromium pro plakáty (jednorázově, ~150 MB)")
    for cmd in ([npm, "install", "--no-audit", "--no-fund", "--silent"], [npm, "exec", "--", "playwright", "install", "chromium"]):
        proc = subprocess.Popen(cmd, cwd=rt, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for ln in proc.stdout:
            if ln.strip():
                LOG.info(ln.rstrip()[:110])
        if proc.wait() != 0:
            LOG.warn("instalace Chromia se nepovedla, plakáty přeskakuji")
            return None
    open(os.path.join(rt, ".ready"), "w").write(VERSION)
    return rt


def render_posters(outdir, styles):
    node = shutil.which("node")
    rt = ensure_runtime() if node else None
    if not node or not rt:
        return []
    shutil.copy(os.path.join(PKG, "node", "render.mjs"), os.path.join(rt, "render.mjs"))
    proc = subprocess.Popen([node, "render.mjs", outdir, ",".join(styles)], cwd=rt,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for ln in proc.stdout:
        LOG.info(ln.rstrip())
    proc.wait()
    return [s for s in styles if os.path.exists(os.path.join(outdir, "plakaty", f"{s}.png"))]


def write_gallery():
    root = os.path.join(HERE, "mapy")
    cards = []
    for d in sorted(os.listdir(root)):
        info = os.path.join(root, d, "info.json")
        if os.path.exists(info):
            i = json.load(open(info))
            thumb = next((f"{d}/plakaty/{s}.png" for s in ("gta5", "vc", "sa") if os.path.exists(os.path.join(root, d, "plakaty", f"{s}.png"))), "")
            cards.append(f'<a href="{d}/index.html"><img src="{thumb}" alt=""><b>{i["name"]}</b><span>{i.get("sub", "")} · {i["generated"]}</span></a>')
    html = ('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GTA mapy</title>'
            '<style>body{margin:0;background:#0b0d11;color:#fff;font:15px system-ui,sans-serif;padding:32px}h1{font:400 40px Impact,sans-serif;letter-spacing:.04em;text-transform:uppercase}'
            '.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px}a{color:#fff;text-decoration:none;background:#151922;border-radius:6px;overflow:hidden;display:grid}'
            'a img{width:100%;aspect-ratio:1;object-fit:cover;background:#222}a b{padding:10px 12px 0;font-size:18px}a span{padding:2px 12px 12px;color:#9aa3ad;font-size:13px}a:hover{outline:2px solid #f1c232}</style>'
            f'<h1>GTA mapy</h1><div class="g">{"".join(cards)}</div>')
    open(os.path.join(root, "index.html"), "w").write(html)


# ---------------------------------------------------------------- full-screen terminal UI (alt screen)
ORG = _c("38;5;208")

# ---------------------------------------------------------------- ASCII art (Vice City sunset palette)
_GLYPH = {
    "G": [" █████ ", "██     ", "██  ███", "██   ██", " █████ "],
    "T": ["███████", "  ███  ", "  ███  ", "  ███  ", "  ███  "],
    "A": [" █████ ", "██   ██", "███████", "██   ██", "██   ██"],
    "M": ["██   ██", "███ ███", "██ █ ██", "██   ██", "██   ██"],
    "P": ["██████ ", "██   ██", "██████ ", "██     ", "██     "],
    "O": [" █████ ", "██   ██", "██   ██", "██   ██", " █████ "],
    "W": ["██   ██", "██   ██", "██ █ ██", "███ ███", "██   ██"],
    "N": ["███  ██", "████ ██", "██ ████", "██  ███", "██   ██"],
    "Y": ["██   ██", " ██ ██ ", "  ███  ", "  ███  ", "  ███  "],
    " ": ["   ", "   ", "   ", "   ", "   "],
}
_PAL = [93, 129, 165, 171, 207, 213, 209, 208]       # violet → magenta → pink → orange


def _rgb(i):
    return f"\033[38;5;{_PAL[max(0, min(len(_PAL) - 1, i))]}m" if _TTY else ""


def _grad(txt, row, rows, col0=0):
    """Colour a line with a diagonal violet→orange gradient."""
    out, n = "", len(_PAL)
    for j, ch in enumerate(txt):
        if ch == " ":
            out += ch
            continue
        t = (row / max(rows - 1, 1)) * 0.65 + ((col0 + j) / 70) * 0.35
        out += _rgb(int(t * (n - 1) + 0.5)) + ch
    return out + RST


def title_rows(word="TOWNYG"):
    return [" ".join(_GLYPH[c][r] for c in word) for r in range(5)]


PALM_BIG = [
    r"           __,,--.  _                ",
    r"     _.-'\ \  \   |   / /'-._          ",
    r"   .'  .-\"\ \  \  |  / /\"-.  '.       ",
    r"  /  .'    \ \  \ | / /    '.  \      ",
    r"      '     ' \  \|/ /  '     '        ",
    r"              ` )|( '                  ",
    r"                ||                     ",
    r"                ||                     ",
    r"               /||                     ",
    r"              _/||\_                   ",
]
PALM_SMALL = [r"  \|/  ", r" --Y-- ", r"   |   ", r"   |   ", r"  _|_  "]


def compose(big=False):
    """Rows (already coloured) of the logo: palm + big letters (+ sunset stripes + tagline when big)."""
    t = title_rows()
    rows = []
    if big:
        palm = [p.replace('\\"', '"') for p in PALM_BIG]
        pw = max(len(p.rstrip()) for p in palm)
        palm = [p[:pw] for p in palm]
        top = ["", "", ""] + t + ["", ""]
        for i, p in enumerate(palm):
            left = _grad(p.ljust(pw), i, len(palm) + 4, 0)
            right = _grad(top[i], i, len(palm), pw) if i < len(top) and top[i] else ""
            rows.append(left + "  " + right)
        w = pw + 2 + len(t[0])
        for k, ch in enumerate("▄▃▂"):
            rows.append(" " * 6 + _rgb(5 + k) + (ch * (w - 12)) + RST)
        rows.append(f"{DIM}{'G T A   M A P S   F R O M   O P E N S T R E E T M A P'.center(w)}{RST}")
    else:
        pw = len(PALM_SMALL[0])
        for i in range(5):
            rows.append(_grad(PALM_SMALL[i], i, 5, 0) + "  " + _grad(t[i], i, 5, pw))
        rows.append(f"{DIM}{' ' * (pw + 2)}GTA V · IV · Vice City · San Andreas z OpenStreetMap{RST}")
    return rows



class TUI:
    """One cbreak session for the whole wizard: no echo between keys, full redraw each frame, alt screen is wiped on exit."""
    def __init__(self):
        self.history = []   # [(label, value)] answered questions, shown above the current one
        self.fd = sys.stdin.fileno()

    def __enter__(self):
        import termios, tty
        self.old = termios.tcgetattr(self.fd)
        tty.setcbreak(self.fd)
        sys.stdout.write("\033[?1049h\033[?25l")
        sys.stdout.flush()
        return self

    def start_run(self, summary):
        """Switch from questions to the progress view: logo on top, log scrolls in a region below it."""
        rows = shutil.get_terminal_size((80, 24)).lines
        head = ["", *("  " + r for r in compose(big=False)), f"  {DIM}{summary}{RST}", f"  {DIM}{'─' * 60}{RST}"]
        sys.stdout.write("\033[H\033[2J" + "\n".join(head) + "\n")
        top = len(head) + 2
        if rows > top + 5:
            sys.stdout.write(f"\033[{top};{rows}r\033[{top};1H")
        sys.stdout.flush()

    def __exit__(self, *exc):
        import termios
        sys.stdout.write("\033[r")
        termios.tcsetattr(self.fd, termios.TCSADRAIN, self.old)
        sys.stdout.write("\033[?25h\033[?1049l")
        sys.stdout.flush()

    def key(self):
        """Next key from a byte buffer, so bursts (key repeat, pasted sequences) never split escape codes."""
        if not getattr(self, "buf", b""):
            self.buf = os.read(self.fd, 64)
        buf = self.buf
        if buf[:1] == b"\x1b":
            if len(buf) == 1:
                r, _, _ = select.select([self.fd], [], [], 0.05)
                if r:
                    buf += os.read(self.fd, 64)
            if len(buf) >= 2 and buf[1:2] in (b"[", b"O"):
                n = 2
                while n < len(buf) and not (0x40 <= buf[n] <= 0x7e):
                    n += 1
                n += 1
            else:
                n = 1
        elif buf[0] >= 0xC0:
            n = 2 if buf[0] < 0xE0 else 3 if buf[0] < 0xF0 else 4
        else:
            n = 1
        k, self.buf = buf[:n], buf[n:]
        if os.environ.get("GTA_KEYLOG"):
            open(os.environ["GTA_KEYLOG"], "a").write(repr(k) + "\n")
        return k.decode(errors="ignore")

    def banner(self, animate=False):
        return compose(big=False)

    def frame(self, title, body, hint, animate=False):
        out = ["\033[H\033[2J"]
        lines = [""] + ["  " + r for r in self.banner()] + [""]
        for lab, val in self.history:
            lines.append(f"  {GRN}✔{RST} {DIM}{lab}{RST}  {val}")
        if self.history:
            lines.append("")
        lines += [f"  {B}{title}{RST}", ""] + body + ["", f"  {DIM}{hint}{RST}"]
        out.append("\n".join(lines))
        sys.stdout.write("".join(out))
        sys.stdout.flush()

    def intro(self):
        """Animated full logo: rows slide in one by one, then a short hold."""
        cols = shutil.get_terminal_size((80, 24)).columns
        rows = compose(big=True)
        if cols < max(len(re.sub(r"\033\[[0-9;]*m", "", r)) for r in rows) + 4:
            rows = compose(big=False)
        sys.stdout.write("\033[H\033[2J\n")
        for r in rows:
            sys.stdout.write("  " + r + "\n")
            sys.stdout.flush()
            time.sleep(0.06)
        time.sleep(0.9)

    def menu(self, label, title, items, multi=False, selected=None, hint=None):
        sel = set(selected if selected is not None else ([items[0][0]] if not multi else []))
        cur = 0
        if not multi and selected:
            cur = next((i for i, (v, _) in enumerate(items) if v == next(iter(sel))), 0)
        hint = hint or ("↑↓ pohyb · mezerník výběr · a vše/nic · Enter potvrdit · Esc zrušit" if multi else "↑↓ pohyb · Enter potvrdit · Esc zrušit")
        while True:
            body = []
            for i, (v, lab) in enumerate(items):
                on = (v in sel) if multi else (i == cur)
                mark = ("◉" if on else "○") if multi else ("●" if on else "○")
                pointer = f"{ORG}❯{RST}" if i == cur else " "
                body.append(f"  {pointer} {GRN if on else DIM}{mark}{RST} {B if i == cur else ''}{lab}{RST}")
            self.frame(title, body, hint)
            k = self.key()
            if k in ("\x03", "\x04", "\x1b", "q"):
                raise KeyboardInterrupt
            if k in ("\x1b[A", "k"):
                cur = (cur - 1) % len(items)
            elif k in ("\x1b[B", "j"):
                cur = (cur + 1) % len(items)
            elif k == " " and multi:
                sel.symmetric_difference_update({items[cur][0]})
            elif k == "a" and multi:
                sel = set() if len(sel) == len(items) else {v for v, _ in items}
            elif k in ("\r", "\n"):
                if multi and not sel:
                    continue
                break
        if multi:
            res = [v for v, _ in items if v in sel]
            shown = ", ".join(re.sub(r"\s{2,}.*", "", l) for v, l in items if v in sel)
        else:
            res = items[cur][0]
            shown = re.sub(r"\s{2,}.*", "", items[cur][1])
        self.history.append((label, re.sub(r"\033\[[0-9;]*m", "", shown)))
        return res

    def ask(self, label, title, hint="Piš název · Enter potvrdit · Esc zrušit", example="Černošín"):
        buf = ""
        while True:
            shown = buf if buf else f"{DIM}{example}{RST}"
            self.frame(title, [f"  {ORG}❯{RST} {shown}{ORG}▌{RST}"], hint)
            k = self.key()
            if k in ("\x03", "\x04", "\x1b"):
                raise KeyboardInterrupt
            if k in ("\r", "\n"):
                if buf.strip():
                    break
            elif k in ("\x7f", "\b"):
                buf = buf[:-1]
            elif k.isprintable() and not k.startswith("\x1b"):
                buf += k
        self.history.append((label, buf.strip()))
        return buf.strip()


def _existing_cities():
    root = os.path.join(HERE, "mapy")
    out = []
    if os.path.isdir(root):
        for d in sorted(os.listdir(root)):
            f = os.path.join(root, d, "info.json")
            if os.path.exists(f):
                try:
                    out.append(json.load(open(f)))
                except Exception:  # noqa
                    pass
    return out


def area_text(a):
    if (a.area or "city") == "city":
        return "oblast: celé město (hranice obce)"
    r = a.radius if a.radius is not None else 2.5
    return f"oblast: čtverec {2 * r:g}×{2 * r:g} km"


def wizard(t, a, need_city, need_styles, need_area=False):
    """Interactive full-screen setup. Fills a.city / a.area / a.radius / a.styles / a.no_posters / a.open."""
    t.intro()
    if need_city:
        cities = _existing_cities()
        choice = "new"
        if cities:
            items = [("new", "✚  Nové město")] + [(c["name"], f"↻  Znovu vygenerovat: {c['name']}  {DIM}({c.get('generated', '')}){RST}") for c in cities]
            choice = t.menu("Akce", "Co chceš udělat?", items)
        if cities:
            t.history.pop()
        if choice == "new":
            a.city = t.ask("Město", "Název města nebo obce")
        else:
            a.city = choice
            t.history.append(("Město", choice))
    if need_city or need_area:
        a.area = t.menu("Oblast", "Jak velká oblast?", [
            ("city", "Celé město (hranice obce)  – doporučeno"),
            ("square", "Čtverec kolem centra"),
        ], selected={"city"})
    if (need_city or need_area) and a.area == "square":
        a.radius = float(t.menu("Velikost", "Velikost čtverce", [
            ("1.5", "Malá     3 × 3 km   – městečko, rychlé"),
            ("2.5", "Střední  5 × 5 km   – doporučeno"),
            ("4", "Velká    8 × 8 km   – delší stahování"),
            ("6", "Obří     12 × 12 km – dlouhé stahování"),
        ], selected={"2.5"}))
    if need_styles:
        games = t.menu("Hry", "Které GTA mapy vygenerovat?", [
            ("gta5", "GTA V           světlá pauza mapa, radar, satelit"),
            ("gta4", "GTA IV          Liberty City, šedé a ostré"),
            ("vc", "Vice City       pastelová neonová osmdesátá"),
            ("sa", "San Andreas    ploché, malované"),
        ], multi=True, selected={"gta5", "gta4", "vc", "sa"})
        styles = []
        if "gta5" in games:
            styles += t.menu("GTA V", "GTA V – které varianty?", [
                ("gta5", "Atlas      světlá mapa z pauzy"),
                ("radar", "Radar      tmavý noční"),
                ("sat", "Satelit    ortofoto look"),
            ], multi=True, selected={"gta5", "radar", "sat"})
        styles += [g for g in ("gta4", "vc", "sa") if g in games]
        a.styles = ",".join(styles)
        opts = t.menu("Volby", "Další volby", [
            ("posters", "Renderovat plakáty (PNG 4096 px)"),
            ("open", "Po dokončení otevřít mapu v prohlížeči"),
        ], multi=True, selected={"posters", "open"})
        a.no_posters = "posters" not in opts
        a.open = "open" in opts
    if t.menu("Start", "Spustit generování?", [("go", "▶ Spustit"), ("no", "✕ Zrušit")]) == "no":
        raise KeyboardInterrupt


def main():
    ap = argparse.ArgumentParser(prog="townyg", description="Generátor GTA map z OpenStreetMap")
    ap.add_argument("--version", action="version", version="townyg " + VERSION)
    ap.add_argument("city", nargs="?", help="název města; bez něj se spustí interaktivní průvodce")
    ap.add_argument("--area", choices=("city", "square"), default=None,
                    help="city = celé město podle hranice obce (výchozí), square = čtverec kolem centra")
    ap.add_argument("--radius", type=float, default=None, help="polovina strany čtverce v km (výchozí 2.5; implikuje --area square)")
    ap.add_argument("--max-size", type=float, default=18.0, help="max. delší strana oblasti v km (výchozí 18)")
    ap.add_argument("--styles", default=None, help="all nebo seznam: " + ",".join(STYLES))
    ap.add_argument("-y", "--yes", action="store_true", help="neptat se, použít výchozí hodnoty")
    ap.add_argument("--no-posters", action="store_true", help="přeskočit renderování plakátů")
    ap.add_argument("--no-relief", action="store_true")
    ap.add_argument("--open", action="store_true", help="po dokončení otevřít mapu v prohlížeči")
    a = ap.parse_args()
    interactive = sys.stdin.isatty() and sys.stdout.isatty() and not a.yes
    if a.area is None and a.radius is not None:
        a.area = "square"
    need_city, need_styles, need_area = not a.city, a.styles is None, a.area is None
    tui = None
    if interactive and (need_city or need_styles or need_area):
        tui = TUI()
        tui.__enter__()
        try:
            wizard(tui, a, need_city, need_styles, need_area)
        except KeyboardInterrupt:
            tui.__exit__()
            sys.exit("Zrušeno.")
    result = None
    try:
        result = run(a, ap, tui)
    except KeyboardInterrupt:
        msg = "Přerušeno."
    except SystemExit as ex:
        msg = str(ex.code) if ex.code not in (None, 0) else ""
    else:
        msg = ""
    if tui:
        k = ""
        if result:
            sys.stdout.write(f"\n  {GRN}✔{RST} {B}Hotovo{RST}   {DIM}O = otevřít mapu · jiná klávesa = zavřít{RST}")
        else:
            sys.stdout.write(f"\n  {RED}✘{RST} {msg or 'Něco se nepovedlo.'}   {DIM}Stiskni klávesu pro zavření{RST}")
        sys.stdout.flush()
        try:
            k = tui.key()
        except KeyboardInterrupt:
            pass
        tui.__exit__()
        if result and k.lower() == "o":
            subprocess.run(["open", os.path.join(result, "index.html")])
    elif not result and msg:
        sys.exit(msg)
    if result:
        print(f"{B}Výstup:{RST}\n  mapa:    {os.path.join(result, 'index.html')}\n  plakáty: {os.path.join(result, 'plakaty')}")
    elif tui and msg:
        print(msg)


def run(a, ap, tui):
    if not a.city:
        ap.error("chybí název města (nebo spusť v terminálu bez parametrů pro průvodce)")
    if a.styles is None:
        a.styles = "all"
    if a.area is None:
        a.area = "city"
    styles = list(STYLES) if a.styles == "all" else [s for s in a.styles.split(",") if s in STYLES]
    if not styles:
        sys.exit("Neznámé styly. Dostupné: " + ", ".join(STYLES))

    t0 = time.time()
    summary = f"{a.city} · {area_text(a)} · {', '.join(STYLES[x] for x in styles)}"
    if tui:
        tui.start_run(summary)
    else:
        print(f"{B}townyg{RST} · {a.city}  {DIM}({area_text(a)}, styly: {', '.join(styles)}){RST}")

    LOG.start("Hledám obec (Nominatim)")
    lat0, lon0, geo = geocode(a.city)
    LOG.done(f"{lat0:.5f}, {lon0:.5f} – {geo['display_name']}")
    plan = plan_area(lat0, lon0, geo, a.area, a.radius, a.max_size)
    P, half_w, half_h = plan["P"], plan["half_w"], plan["half_h"]
    half = max(half_w, half_h)
    LOG.info(f"oblast mapy: {2 * half_w / 1000:.1f} × {2 * half_h / 1000:.1f} km (režim {plan['mode']})")

    LOG.start("Připravuji složku")
    slug = slugify(a.city)
    outdir = os.path.join(HERE, "mapy", slug)
    os.makedirs(os.path.join(outdir, "plakaty"), exist_ok=True)
    LOG.done(f"mapy/{slug}/")

    LOG.start("Stahuji data z OpenStreetMap po dlaždicích (Overpass)")
    t_dl = time.time()
    try:
        osm, ntiles = fetch_osm(P, half_w, half_h, outdir)
    except (RuntimeError, KeyboardInterrupt) as ex:
        sys.exit(f"Stahování se nepovedlo: {ex} – hotové dlaždice zůstaly v cache, stačí spustit znovu.")
    LOG.done(f"{_fmt(len(osm['elements']))} prvků" + (f", {ntiles} dlaždic, {time.time() - t_dl:.0f} s" if ntiles else " (z cache)"))

    LOG.start("Zpracovávám: plochy, silnice, budovy, místa, autobusy")
    layers = process(osm["elements"], P, half_w, half_h)
    LOG.info(f"budov {len(layers['buildings'])} · silnic {len(layers['roads'])} · vodních toků {len(layers['waters'])} · "
             f"míst {len(layers['pois'])} · ploch {sum(len(v) for v in layers['areas'].values())}")
    if layers["busRoutes"]:
        LOG.info(f"autobusových linek v OSM: {len(layers['busRoutes'])}")
    else:
        LOG.warn("OSM neobsahuje autobusové linky – trasu odvodím ze zastávek po silnicích")
    LOG.done("hotovo")

    LOG.start("Stahuji terén a počítám stínovaný reliéf (AWS Terrarium)")
    relief = None
    if not a.no_relief:
        try:
            step = max(4.0, math.ceil(max(2 * half_w, 2 * half_h) / 3200))
            relief = build_relief(P, half_w, half_h, step=step)
            LOG.done(f"výška {relief['hmin']:.0f}–{relief['hmax']:.0f} m n. m.")
        except Exception as ex:  # noqa
            LOG.warn(f"reliéf se nepodařilo vytvořit: {ex}")
    else:
        LOG.done("přeskočeno (--no-relief)")

    LOG.start("Zapisuji data mapy")
    parts = [p.strip() for p in geo["display_name"].split(",")]
    sub = " · ".join(p for p in parts[1:4] if not re.fullmatch(r"[\d ]+", p))
    data = {"name": a.city, "sub": sub, "lat0": P.lat0, "lon0": P.lon0, "half": half, "halfW": half_w, "halfH": half_h,
            "kx": P.kx, "ky": P.ky, "boundary": plan["boundary"], "area": {"mode": plan["mode"], "km2": plan["km2"]},
            **layers, "relief": relief, "generated": time.strftime("%Y-%m-%d"),
            "styles": {k: STYLES[k] for k in styles}, "defaultStyle": styles[0]}
    with open(os.path.join(outdir, "data.js"), "w") as f:
        f.write("window.MAPDATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";")
    json.dump({"name": a.city, "sub": sub, "generated": data["generated"], "styles": styles, "radius_km": a.radius,
               "area": plan["mode"], "size_km": [round(2 * half_w / 1000, 2), round(2 * half_h / 1000, 2)], "km2": plan["km2"]},
              open(os.path.join(outdir, "info.json"), "w"), ensure_ascii=False, indent=1)
    LOG.done(f"data.js {os.path.getsize(os.path.join(outdir, 'data.js')) / 1e6:.2f} MB")

    LOG.start("Kopíruji šablonu mapy (index.html, app.js)")
    for fn in ("index.html", "app.js"):
        shutil.copy(os.path.join(PKG, "template", fn), os.path.join(outdir, fn))
    LOG.done("šablona zkopírována")

    LOG.start(f"Renderuji plakáty ({len(styles)} stylů)")
    if a.no_posters:
        LOG.done("přeskočeno (--no-posters)")
    else:
        made = render_posters(outdir, styles)
        LOG.done(f"{len(made)}/{len(styles)} plakátů v mapy/{slug}/plakaty/")

    LOG.start("Aktualizuji galerii měst")
    write_gallery()
    LOG.done("mapy/index.html")

    print(f"\n{B}{GRN}Hotovo{RST} za {time.time() - t0:.0f} s")
    if a.open:
        subprocess.run(["open", os.path.join(outdir, "index.html")])
    return outdir


if __name__ == "__main__":
    main()
