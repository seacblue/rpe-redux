# Bundled Extensions

Each child directory is one built-in Extension package. The folder name equals the manifest `id`, and the package is compiled into the application from this directory. The runtime and manifest contract live in `src/core/extensions/`. A package is either a code package with an `entry` or a data-only package with a `scripts` array and no entry. One package may register any number of scripts; a script id is local to its package.

```text
builtin.official/
  manifest.json
  i18n.json
  index.js
```

## Manifest

`manifest.json` declares `kind`, `id`, `version`, `engines`, `capabilities`, optional `entry`, optional `i18n`, optional `collaboration`, and the localized text. `engines` accepts the legacy integer host major or a semver range string over the full host version (for example `">=1.0.0-a1 <2.0.0"`). A code package's entry provides a default definition and `activate(context)`; it registers scripts with `context.scripts.register`. A data-only package declares each script under `scripts` with a local `id`, optional label/description, optional parameter schema, and at least one host-owned step. Data-only packages cannot declare `ui.*` or `shortcuts` capabilities.

The host validates the manifest and capability names. Catalog keys are bare; `extension.` and `extension::` prefixes are reserved, and category text is derived from the package owner and id. `author`, `license`, and provenance fields are metadata; they do not grant trust. `collaboration` is `local` by default. Use `chart` when the package's result is carried by normal chart transactions or room assets, and `shared-service` only when clients using the feature must install the same package. Room asset uploading never installs or executes Extension files.

## Official packages

`builtin.official` registers the requested note transforms: `MirrorY`, `MirrorMid`, `SideSwitch`, `SideUp`, `SideDown`, `ToReal`, `ToFake`, `ToTap`, `ToFlick`, `ToDrag`, and `ToHold`. It is intentionally readable: copy the package into a user Extension and change one transform to learn the SDK boundary.

See [Extensions](../../../docs/extensions.md) for the full contract.
