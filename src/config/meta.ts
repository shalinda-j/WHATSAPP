/** Current Meta Graph API version used by WhatsApp, Facebook and Instagram. */
export const META_GRAPH_VERSION =
  process.env.META_GRAPH_VERSION ||
  process.env.WHATSAPP_GRAPH_VERSION ||
  'v25.0';

export const META_GRAPH_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
