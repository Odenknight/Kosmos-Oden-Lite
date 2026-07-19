# Storage provider and multi-target sync study

Date: 2026-07-18
Baseline: Kosmos-Oden `0.6.5-beta.2`, `main.js` = **1,349,137 bytes**
(431,157 gzip; 335,340 Brotli).

## Recommendation

Add four provider types: **Google Drive, Microsoft OneDrive, Dropbox, and
S3-compatible object storage**. This is a practical coverage ranking for the
Kosmos audience, not a claim of a universal market-share survey:

1. Google Drive — broad consumer, education, Android, and Workspace reach.
2. OneDrive — Windows and Microsoft 365 personal/organizational reach.
3. Dropbox — mature cross-platform file-sync audience; Dropbox reported over
   700 million registered and 18.07 million paying users in September 2025.
4. S3-compatible — one adapter covers AWS S3, Cloudflare R2, Backblaze B2,
   MinIO, Wasabi, and other compatible endpoints. AWS says millions of
   customers store hundreds of exabytes in S3.

iCloud is intentionally not in the implementation shortlist: it is common for
Obsidian users, but it does not provide a comparable general-purpose,
cross-platform third-party Files API suitable for one Obsidian plugin on
Windows, Android, macOS, and iOS.

## Measured `main.js` impact

The benchmark bundles current pinned SDKs or minimal REST transports with
esbuild, minification, tree-shaking, and a browser/ES2020 target. Figures are
incremental standalone bundle payloads; shared code in the final plugin may
reduce them slightly.

| Provider | Official SDK path, raw | Increase over `main.js` | Lean auth/connectivity floor, raw | Production REST estimate |
|---|---:|---:|---:|---:|
| Google Drive | Not browser-bundle compatible | — | 1,929 B | 8–15 KB |
| OneDrive (MSAL + Graph) | 298,266 B | 22.1% | 1,748 B | 8–15 KB |
| Dropbox | 48,849 B | 3.6% | 2,015 B | 7–13 KB |
| S3 (AWS SDK) | 263,355 B | 19.5% | 8,117 B | 12–22 KB |
| All four | >610,470 B before Google | >45.2% | 12,157 B deduplicated | 35–65 KB |

Compressed official-SDK additions for OneDrive + Dropbox + S3 total 167,438
gzip bytes, a 38.8% increase over the current gzipped plugin. The four lean
connectivity fixtures total 4,387 gzip bytes after shared OAuth code is
deduplicated. For calibration, the existing complete Nextcloud module bundles
to 13,234 raw / 4,625 gzip bytes.

The lean figures are lower bounds, not release forecasts. Production estimates
include provider-specific pagination, folder/file identity mapping, change
cursors, resumable uploads, conditional writes, rate-limit handling,
diagnostics, migrations, and tests. A clean REST implementation should keep all
four providers plus a shared coordinator to roughly **50–90 KB raw** (about
3.7–6.7% of current `main.js`).

### SDK decision

Do not embed the full vendor SDKs:

- Google’s supported JavaScript/Node client packages are not an offline,
  browser-bundle solution for Obsidian mobile; use Drive REST directly.
- MSAL + Microsoft Graph adds almost 300 KB before sync logic.
- Dropbox's SDK is smaller, but a common REST/OAuth layer is smaller still.
- The current AWS SDK requires ES2020 because of BigInt literals, while the
  plugin production bundle still targets ES2018. A small audited SigV4 signer
  avoids both the 263 KB payload and a global target change.

Exact benchmark inputs and fixtures are under
`benchmarks/provider-size-study/`. The fixtures prove bundle size and basic
connectivity shape only; they are explicitly not production adapters.

## Authentication and connectivity constraints

### Shared OAuth layer

Google, OneDrive, and Dropbox can share PKCE generation, state/CSRF validation,
token exchange/refresh, expiry handling, Secret Storage, and account
disconnect logic. Each profile needs its own secret identifier. Refresh tokens
must never enter `data.json`, logs, conflict files, or synchronized `.obsidian`
content.

OAuth is an operational dependency, not just code size. Kosmos-Oden needs
registered client IDs, redirect handling on every supported platform, provider
consent-screen configuration, privacy/terms pages, and—for Google—potential
verification. Google requires platform-appropriate OAuth clients and supports
PKCE for installed apps. Microsoft recommends authorization-code + PKCE for
SPA/native clients. Dropbox recommends authorization-code + PKCE with refresh
tokens for desktop/mobile background access.

Recommended scopes:

- Google Drive: `drive.file`, plus a provider-owned manifest/index.
- OneDrive: `Files.ReadWrite.AppFolder` and `offline_access`.
- Dropbox: App Folder access with file content/metadata scopes.
- S3: least-privilege IAM credentials restricted to one bucket and prefix;
  SigV4 over HTTPS, supporting custom S3-compatible endpoints and path/virtual
  host style where required.

Large-file support must follow each provider’s rules: Google resumable upload,
OneDrive upload sessions, Dropbox upload sessions, and S3 multipart upload.

## Can Kosmos sync to n+1 services?

Yes, but **not safely by running the current single-target engine repeatedly**.
Sequential engines would let target A modify the local vault while target B is
still comparing an older snapshot, causing echo uploads, false conflicts, and
delete resurrection.

Use a hub-and-spoke coordinator where the local vault is the canonical hub:

```text
one immutable local snapshot
        ↓
enumerate every enabled target
        ↓
plan all target deltas without writing
        ↓
stage downloads + detect cross-target conflicts
        ↓
commit one resolved local generation
        ↓
fan out that generation to replica/backup targets
        ↓
persist per-target journal and common state
```

Required model:

- `StorageProvider`: list/stat/get/put/delete/capabilities interface.
- `StorageProfile`: stable ID, provider type, mode, folder/prefix, exclusions,
  schedule, and secret references.
- Per-profile state keyed by `(profileId, normalizedPath)`, never one global
  ETag/state map.
- One global coordinator lock and one immutable local snapshot per run.
- Per-target operation journal so partial cloud failures can resume safely;
  no false claim of a cross-cloud atomic transaction.
- Provider-qualified conflict names, such as
  `note.google-drive-conflict-<timestamp>.md`.
- Tombstones retained until every replica target acknowledges the deletion.
- Bounded parallelism per target plus global bandwidth/concurrency limits.

Profiles need explicit modes:

- **Replica**: participates in bidirectional convergence.
- **Backup**: receives local generations but never changes or deletes local
  files.
- **Import**: pulls into staging and requires review before local application.

For a replica group, conflicting versions from multiple remotes must all be
preserved before choosing a canonical version. The safe default is local-wins
after preserving every remote variant; an advanced policy can select newest
only when provider clocks and revision metadata are trustworthy.

## Proposed implementation order

1. Refactor Nextcloud behind `StorageProvider` and introduce profiles plus the
   coordinator, while keeping one Nextcloud profile behavior-compatible.
2. Add S3-compatible storage first: broad coverage and no browser redirect
   flow, making it the best coordinator stress test.
3. Add Dropbox: simplest OAuth/file API of the consumer providers.
4. Add OneDrive App Folder.
5. Add Google Drive last because file-ID/path mapping, redirect setup, consent
   configuration, and verification create the largest operational risk.

Do not enable multi-replica operation until crash-resume, partial failure,
cross-target conflict, deletion tombstone, clock-skew, and offline-device tests
are in CI.

## Primary references

- [Google installed-app OAuth and PKCE](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google Drive uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Microsoft authentication flows and PKCE](https://learn.microsoft.com/en-us/entra/msal/msal-authentication-flows)
- [Microsoft Graph upload sessions](https://learn.microsoft.com/en-us/graph/api/resources/uploadsession?view=graph-rest-1.0)
- [Dropbox OAuth guide](https://developers.dropbox.com/oauth-guide)
- [Amazon S3 SigV4 authentication](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-authenticating-requests.html)
- [Amazon S3 multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CreateMultipartUpload.html)
- [Dropbox September 2025 filing](https://investors.dropbox.com/node/13271/html)
- [AWS S3 scale overview](https://pages.awscloud.com/rs/112-TZM-766/images/s3-pi-day-infographic.pdf)
