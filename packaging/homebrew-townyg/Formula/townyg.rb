class Townyg < Formula
  include Language::Python::Virtualenv

  desc "GTA-style interactive maps and posters of any town, from OpenStreetMap"
  homepage "https://metjum.github.io/townyg/"
  url "https://github.com/metjum/townyg/archive/refs/tags/v0.1.1.tar.gz"
  sha256 "9e560c7c54df8313a774bacf169669ba68c0ad34756057bce10b2056cd365ad3"
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
