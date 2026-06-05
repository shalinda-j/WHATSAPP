# Baileys (WhatsApp) — ToS & Maintenance Risk Acknowledgement

**Finding #69** — `@whiskeysockets/baileys` (pinned `6.6.0`) is an **unofficial,
reverse-engineered WhatsApp Web library**. This document is the accepted
mitigation for #69 (no code change); it records the risk so it is visible during
compliance review.

## The risk

- **Terms of Service / ban risk.** Baileys connects to WhatsApp's Web/multi-device
  protocol without using an official API. This violates WhatsApp's Terms of
  Service. Numbers driven through it can be **rate-limited, flagged, or
  permanently banned** at WhatsApp's discretion, with no appeal path and no SLA.
- **Maintenance / supply-chain risk.** It tracks an unofficial protocol that
  WhatsApp can change at any time. A protocol change can break sessions until the
  library is updated, and the project's release cadence is outside our control.
- **No official support.** There is no vendor support channel; outages during a
  protocol break must be absorbed by us.

## Recommended production alternative

The **official [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api)**
(Meta) is the supported, ToS-compliant path for production messaging. It requires
Meta Business verification and a registered WhatsApp Business Account, and bills
per conversation, but removes the ban/maintenance exposure above.

The codebase already has a channel-adapter abstraction (`src/channels/`,
`IChannelAdapter` + `ChannelRouter`) and stub Meta adapters
(`InstagramAdapter`, `FacebookMessengerAdapter`) pending Meta business
verification — the same surface a WhatsApp Cloud API adapter would plug into,
which keeps a future migration off Baileys low-friction.

## Action for deployments

- **Document this Baileys dependency in the compliance review** for any
  production deployment, and treat the WhatsApp number(s) as **expendable /
  ban-exposed** infrastructure.
- For any deployment that cannot tolerate a ban, **migrate to the official
  WhatsApp Cloud API** before going live.
- Keep `@whiskeysockets/baileys` **version-pinned** (currently `6.6.0`) and
  upgrade deliberately, testing session auth after each bump.

_Status: risk acknowledged. No code change required for #69._
