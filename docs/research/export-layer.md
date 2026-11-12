# Export-layer architecture research

## Conclusion

The requested export layer is worthwhile. The repository already has the first stage, but it is implicit: `projectChartForExport` converts the working RPE-shaped chart into the native shape required by PEZ, while the official JSON and PEC writers perform their own runtime sampling and return loss warnings. The safer long-term pipeline is:

```text
working/editor model -> export conversion + diagnostics -> target adapter -> container writer
```

The first implementation can keep the current `Chart` model as input. A future editor-oriented model can implement the same adapter contract without teaching PEZ or Rust about editor semantics.

## Evidence from the current code

- [`exportProjection.ts`](../../src/core/global/chart/exportProjection.ts) already projects native defaults, package identity, noise data, and version markers without mutating the working chart.
- [`package.ts`](../../src/core/global/document/package.ts) owns PEZ entry layout, `Info.txt`, `extra.json`, and resource entries; it should remain a container writer rather than become the home of future editor-model conversion.
- [`official.ts`](../../src/core/global/chart/formats/official.ts) and [`pec.ts`](../../src/core/global/chart/formats/pec.ts) already sample/flatten unsupported features and return warnings. Their warnings are currently plain strings, so the new pipeline wraps them in stable diagnostic records.
- The native path in [`documentStore.ts`](../../src/core/platform/desktop/documentStore.ts) stages chart JSON and assets, while Rust owns ZIP/filesystem transport. Semantic conversion should stay in `core/`; Rust should not learn chart rules.
- [`docs/compatibility.md`](../compatibility.md) explicitly requires unsupported features to be reported rather than silently dropped, and the existing modal queue already provides `requestConfirm` for a continue/cancel decision.

## Decision and policy

The implementation adds a typed `ExportModelAdapter<TModel>` seam. It returns an RPE-shaped intermediate chart plus structured warnings. The current adapter wraps `projectChartForExport`; target writers then produce PEZ, official JSON, or PEC. This is the requested code seam/backdoor, but it is explicit and testable instead of an undocumented global flag.

The frontend asks for confirmation before any browser or native write whenever the conversion reports warnings. A warning is not an export error: the user may continue or cancel. Hard constraints such as unsafe resource paths remain errors and must continue to block the writer.

## Follow-up work

The next migration step, when the internal authoring format exists, is to add an adapter from that model to the RPE export intermediate and move loss detection into that adapter. The PEZ package writer and warning modal do not need to change. For a detailed report with line-level evidence, see the research agent's original notes in the task history.
