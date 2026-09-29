/**
 * Vite's `?url` import suffix resolves an asset (here the pdf.js worker) to a
 * hashed URL string. TypeScript does not know the suffix, so declare it once
 * here rather than casting at the import site.
 */
declare module '*?url' {
  const url: string;
  export default url;
}
