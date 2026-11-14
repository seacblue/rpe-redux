/** Durable workspace state stored beside a library project. */
export interface LibraryViewState {
  lineIndex?: number;
}

/** A lightweight library project reference carried with an opened document. */
export interface LibraryProjectRef {
  id?: string;
  /** Optimistic-concurrency token returned by the last load or save. */
  revision?: number;
  name?: string;
  group?: string;
  /** Cover asset name resolved by the library when the chart was written. */
  background?: string;
  /** Generated low-resolution cover used by welcome-page previews. */
  thumbnail?: string;
  assetFolders?: string[];
  viewState?: LibraryViewState;
}
