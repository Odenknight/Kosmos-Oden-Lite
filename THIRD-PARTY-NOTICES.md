# Third-Party Notices

Kosmos-Oden bundles and builds upon the following third-party work.

## Three.js

The 3D renderer bundles **Three.js** (r185, npm `three@0.185.1`), © 2010–2025
three.js authors, under the MIT License. It is an exact-pinned npm dependency
(`package.json` + `package-lock.json`, integrity recorded in
`renderer-provenance.json`); esbuild bundles the ESM module into `main.js`,
`vault-kosmos.html` and `dist/kosmos-embed.html` at build time — no CDN, no
runtime fetch, still a single offline file. The previous vendored global r128
build is retained under `vendor/legacy/` (see its `.PROVENANCE.json`) for an
optional frozen WebGL1-era compatibility artifact only.

```
The MIT License

Copyright © 2010-2021 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Three.js: <https://github.com/mrdoob/three.js>

## Upstream project — vault-kosmos

Kosmos-Oden is an independent fork and rebuild of
[**H4R7W16/vault-kosmos**](https://github.com/H4R7W16/vault-kosmos), also MIT
licensed. The MIT license permits this fork; substantial modifications in this
repository are described in `CHANGELOG.md` and `docs/ARCHITECTURE.md`. This
project is not endorsed by or affiliated with the upstream author.

## Build & dev dependencies

`esbuild` (MIT), `typescript` (Apache-2.0) and `obsidian` type definitions are
development/build dependencies only; they are not redistributed in the plugin
or standalone artifacts. Exact versions are pinned in `package.json` and
`package-lock.json`.
