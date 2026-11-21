# In-app Pet

An in-app pet built from the public surface and packaged-asset APIs. It is disabled by default; enable it from **Extensions** in Settings.

The folder is also a distributable package template:

1. Copy `builtin.pet` to a new folder and change `manifest.json`'s `id`, `name`, and version. Keep the folder name equal to the new id.
2. Keep media files under `assets/` and declare each one in `manifest.assets`. The map key is the name used by `context.assets.url(name)`.
3. Publish the folder to GitHub and install it through **Extensions → Install from GitHub** (or use a marketplace entry). The installer downloads the declared assets into the managed package folder; the sandbox never receives a filesystem path.
4. Enable the installed package in Settings. Its persistent surface appears in the editor window.

Assets are bounded to 64 declared files, 4 MB per file, and 12 MB per package. Supported media extensions are PNG, JPEG, WebP, GIF, SVG, AVIF, and BMP. An animation is a frame sequence; GIFs play directly through the browser.
