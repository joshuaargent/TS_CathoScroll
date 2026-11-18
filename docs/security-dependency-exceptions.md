# Dependency audit exceptions

## GHSA-fc5q-39xc-vjpf — picomatch ReDoS

High severity — accepted temporarily

As of 18 November 2026, GitHub's advisory reports picomatch versions through 4.0.7 as affected by a regular-expression denial-of-service condition involving repeated single-branch extglobs. The advisory does not publish a patched version. The current dependency trees include picomatch transitively through build and lint tooling, including Next PWA/Workbox, Vite and TypeScript ESLint.

The affected glob patterns are supplied by CathoScroll's own build/lint configuration and dependencies; the application does not accept user-controlled glob patterns. This reduces the practical exposure but does not make the upstream finding disappear.

The security workflow therefore allows only this exact advisory ID, and only when every reported vulnerability resolves exclusively through this advisory. Any other advisory, unresolved dependency chain, malformed audit report or npm audit execution failure still fails the job. The exception applies to both the root and Electron dependency trees.

Do not broaden this allowlist or suppress the whole picomatch package. Reassess this exception when the upstream project publishes a version outside the affected range or changes the advisory status, then remove the allowlist and restore unfiltered npm audit --audit-level=moderate checks.

Source: [GitHub Security Advisory GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
