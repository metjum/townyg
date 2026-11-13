class Townyg < Formula
  include Language::Python::Virtualenv

  desc "GTA-style interactive maps and posters of any town, from OpenStreetMap"
  homepage "https://metjum.github.io/townyg/"
  url "https://github.com/metjum/townyg/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "f13cde00d4bb3f4b8297014c86a646b8589e4feb7d2055662eb08b4924f4d77e"
  license "MIT"
  head "https://github.com/metjum/townyg.git", branch: "main"

  depends_on "node"
  depends_on "python@3.13"

  def install
    venv = virtualenv_create(libexec, "python3.13")
    system libexec/"bin/python", "-m", "pip", "install", "--no-cache-dir", "pillow", "numpy", buildpath
    bin.install_symlink libexec/"bin/townyg"
  end

  def caveats
    <<~EOS
      Maps are written to ~/Townyg (override with TOWNYG_HOME).
      Posters need headless Chromium; townyg installs it on first use (~150 MB, needs node, already a dependency).
    EOS
  end

  test do
    assert_match "townyg #{version}", shell_output("#{bin}/townyg --version")
  end
end
