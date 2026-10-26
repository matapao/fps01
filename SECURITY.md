# Security

Security fixes target the current development branch. Older game builds are not maintained as
separate security release lines.

For a confidential report, use this repository's **Security → Advisories → Report a vulnerability**
when GitHub private vulnerability reporting is enabled. If that option is unavailable, open an issue
requesting a private contact channel without including exploit instructions, credentials or personal
data. Include affected revisions and reproduction details once a private channel is established.

The built-in server is designed for trusted LAN play. It has message limits, origin checks and bounded
queues, but no public-host authentication or admission system. Client movement is predicted and
bounded rather than fully server-authoritative. Choose a trusted network and do not expose a game
instance directly to the internet without providing the required access controls.

`npm run audit` checks the locked dependencies against npm's advisory service. It requires network
access and is separate from the reproducible local quality gate.
