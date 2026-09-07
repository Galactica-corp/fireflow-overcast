# Security Policy

## Supported versions

This repository tracks the Overcast node package as released from FireFlow. Security fixes land in FireFlow first and are copied here on the next public snapshot.

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Please report vulnerabilities privately:

- Email [security@galactica.com](mailto:security@galactica.com) with the subject `fireflow-overcast security`
- Or open a private [GitHub security advisory](https://github.com/Galactica-corp/fireflow-overcast/security/advisories/new)

Include the affected files, a description of the issue, and a reproduction if you have one. We will acknowledge receipt and follow up with a planned disclosure timeline.

This package handles Aztec account material through FireFlow vault secrets. Reports that involve secret handling, signing-key leakage on ports, or x402 settlement bypass are especially in scope.
