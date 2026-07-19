# Provider bundle-size study

Reproducible lower-bound measurement for `docs/STORAGE-PROVIDER-STUDY.md`.
The `*-rest.ts` files deliberately include only authentication and basic
list/get/put/delete connectivity. They are benchmark fixtures, not production
sync adapters. Production adapters require pagination, resumable transfers,
change cursors, retry/backoff, remote identity mapping, validation, and tests.

Pinned packages:

- `@azure/msal-browser@5.17.1`
- `@microsoft/microsoft-graph-client@3.0.7`
- `dropbox@10.37.1`
- `@aws-sdk/client-s3@3.1090.0`
- `aws4fetch@1.0.20`

Run from this directory after installing the isolated dependencies:

```bash
pnpm install --ignore-scripts
node size.mjs
```

The build target is ES2020 because the measured AWS SDK fails the production
plugin's current ES2018 target due to BigInt literals.
