#!/usr/bin/env python3
"""Complete a Foundry standard-JSON input that is missing sources.

`forge verify-contract` resolves imports with the global remapping even where
a context remapping applies (`lib/v4-core/:solmate/=lib/solmate/`), so
v4-core's `solmate/src/...` imports resolve to `lib/solmate/src/src/...`,
are dropped, and BaseScan's compile fails with "Source ... not found".
This re-resolves every import the way solc will (longest-context, then
longest-prefix remapping) and adds whatever is missing from disk.

usage: fix_std_json.py IN.json OUT.json   (run from contracts/)
"""
import json, os, re, sys

IMPORT = re.compile(r'^\s*import\s+(?:[^"\']*?\s+from\s+)?["\']([^"\']+)["\']', re.M)

def remap(importer, path, remappings):
    best = None
    for r in remappings:
        ctx, rest = (r.split(":", 1) if ":" in r.split("=", 1)[0] else ("", r))
        prefix, target = rest.split("=", 1)
        if importer.startswith(ctx) and path.startswith(prefix):
            key = (len(ctx), len(prefix))
            if best is None or key > best[0]:
                best = (key, target + path[len(prefix):])
    return best[1] if best else path

def resolve(importer, path, remappings):
    if path.startswith("."):
        return os.path.normpath(os.path.join(os.path.dirname(importer), path))
    return remap(importer, path, remappings)

def main(src, dst):
    d = json.load(open(src))
    rm, sources = d["settings"]["remappings"], d["sources"]
    todo, added = list(sources), []
    while todo:
        f = todo.pop()
        for imp in IMPORT.findall(sources[f]["content"]):
            p = resolve(f, imp, rm)
            if p not in sources:
                if not os.path.isfile(p):
                    sys.exit(f"unresolvable import {imp!r} from {f} -> {p}")
                sources[p] = {"content": open(p).read()}
                todo.append(p); added.append(p)
    json.dump(d, open(dst, "w"))
    print(f"added {len(added)} source(s): {', '.join(added) or '-'}")

if __name__ == "__main__":
    main(*sys.argv[1:3])
