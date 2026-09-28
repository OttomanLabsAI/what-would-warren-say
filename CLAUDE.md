# what-would-warren-say

## Git identity

Every commit is the owner's work. Before the first commit of any session:

```bash
git config user.name "Fid" && git config user.email "fid_kk@proton.me"
```

No model names, tool names, bot accounts, AI attribution trailers or session
links in commit messages, release text, code comments or authorship.

## Releases

Every push to `main` is a release. Develop on the assigned working branch,
verify, commit with an imperative subject and a prose body, push the working
branch, then fast-forward `main` onto it and push. Versions are an ascending
`vMAJOR.MINOR` counter starting at `v1.0`: each push to `main` bumps the minor
by one (`v1.9` is followed by `v1.10`). A major bump is reserved for a
ground-up overhaul. Never push tags or create releases from the tooling: the
release-tag text (Tag / Title / Description) is handed back in the reply and
the owner creates the GitHub release by hand. Append the new release's row to
the ledger below in the same push.

## Prompt archive

`prompt text/` holds the records for the version currently in service -
nothing else. Shipping version N replaces the folder's contents wholesale, in
the same push that releases the version: remove the previous version's
folder(s) and add `prompt text/N/` containing `input.txt` (the prompt, byte
for byte), `output.txt` (the reply that shipped it, byte for byte),
`ai model.txt` (three lines: Anthropic / Claude / Fable 5 Max unless the owner
directs otherwise) and any input images or files the owner provided. The files
are owner-supplied records: never edit, reformat, trim or regenerate them.
The prompt number is a running count of shipped prompts and is not the release
tag: a release that ships no new prompt leaves the archive as it is.

## Release ledger

| Tag | Title | Prompt |
| --- | --- | --- |
