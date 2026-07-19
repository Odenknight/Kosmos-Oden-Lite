/** Built HTML artifacts are imported as base64 strings (esbuild base64 loader). */
declare module "*.html" {
  const base64: string;
  export default base64;
}
