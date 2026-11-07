# Chart compatibility corpus

This directory catalogues charts used to check compatibility. It is separate from the generated fixtures in the parent directory, which are deterministic harness inputs.

## Entry rules

A chart may be committed only as:

- **metadata-only** — provenance and licensing recorded, no chart bytes; or
- **a small redistributable sample** — at most 256 KiB, with a redistribution licence recorded.

Larger or non-redistributable charts stay outside the repository. Private samples belong in the ignored `corpus/private/` directory.

## Manifest

One entry per chart or package records the files that may be committed, needed resources, the format and notable features, and provenance/licence. Compatibility checks assert semantic outcomes such as preserved notes, events, resources, and unknown fields; they do not depend on exact object counts or internal fixture layout.
