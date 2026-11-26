# Security Policy

## Supported Versions

This project is **unaudited** and handles escrowed funds. Security fixes are provided for the
latest released version of each component only. Older versions do not receive security updates.

| Component | Supported versions |
| --------- | ------------------ |
| Smart contract (`packages/contract`) | Latest released version |
| Server (`packages/server`) | Latest released version |
| SDK (`packages/sdk`) | Latest released version |
| App (`packages/app`) | Latest released version |

If you are running an older version, upgrade to the latest release before reporting an issue that
may already be fixed.

## Reporting a Vulnerability

**Please do not open a public issue, pull request, or discussion for security problems.**

Report vulnerabilities privately through **GitHub private vulnerability reporting**:

1. Go to the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Fill in the advisory form with a description, affected component(s) and version(s), and
   reproduction steps or a proof of concept if available.

This channel is private between you and the maintainers. If you cannot use GitHub private
vulnerability reporting, contact the maintainers listed in the repository profile to arrange an
alternative private channel.

> **Maintainer note:** private vulnerability reporting must be enabled in the repository settings
> (Settings → Code security → Private vulnerability reporting). This is a manual, one-time step.

## What to Include

- A clear description of the vulnerability and its impact.
- The affected component(s) and version(s) (contract, server, SDK, or app).
- Steps to reproduce, or a proof of concept.
- Any suggested remediation, if you have one.
- Whether you intend to disclose publicly, and on what timeline.

## Expected Response Times

These are targets, not guarantees. This is a volunteer-maintained project.

| Stage | Target |
| ----- | ------ |
| Acknowledgement of report | Within 3 business days |
| Initial assessment and severity triage | Within 7 business days |
| Fix or mitigation plan for confirmed issues | Within 30 days, depending on severity |
| Public advisory (coordinated disclosure) | Within 90 days of the report, or sooner once a fix is released |

We will keep you informed of progress and credit you in the advisory unless you ask to remain
anonymous.

## Scope

In scope:

- **Smart contract** — logic errors, access control flaws, reentrancy, fund-handling and escrow
  bugs, upgrade or initialization issues.
- **Server** — authentication and authorization flaws, injection, secret leakage, denial of
  service, unsafe handling of escrowed funds or keys.
- **SDK** — unsafe defaults, credential handling, signature or transaction construction flaws.
- **App** — client-side vulnerabilities that affect funds, keys, or user data.

Out of scope:

- Issues in dependencies that are already publicly known and have an upstream fix (report those
  upstream).
- Findings that require a compromised device, browser extension, or physical access.
- Social engineering, spam, or best-practice suggestions without a concrete security impact.
- The fact that the project is unaudited — this is documented and known.

## Safe Harbor

We will not pursue legal action against researchers who act in good faith, follow this policy,
avoid privacy violations and data destruction, and give us reasonable time to fix the issue before
public disclosure.