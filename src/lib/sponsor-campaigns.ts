export const SPONSOR_CARD_CADENCE = 10;

export interface SponsorFeedCampaign {
  campaign_id: string;
  sponsor_name: string;
  campaign_name: string;
  headline: string;
  body: string;
  image_url: string | null;
  destination_url: string;
  cta_label: string;
  disclosure: 'Sponsored';
  measurement_receipt?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isSponsorFeedCampaign(value: unknown): value is SponsorFeedCampaign {
  if (!isRecord(value)) return false;
  return (
    typeof value.campaign_id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.campaign_id) &&
    typeof value.sponsor_name === 'string' &&
    value.sponsor_name.length > 0 &&
    value.sponsor_name.length <= 120 &&
    typeof value.campaign_name === 'string' &&
    value.campaign_name.length > 0 &&
    value.campaign_name.length <= 120 &&
    typeof value.headline === 'string' &&
    value.headline.length > 0 &&
    value.headline.length <= 100 &&
    typeof value.body === 'string' &&
    value.body.length > 0 &&
    value.body.length <= 500 &&
    (value.image_url === null || isSafeHttpsUrl(value.image_url)) &&
    isSafeHttpsUrl(value.destination_url) &&
    typeof value.cta_label === 'string' &&
    value.cta_label.length > 0 &&
    value.cta_label.length <= 32 &&
    value.disclosure === 'Sponsored' &&
    (value.measurement_receipt === undefined || value.measurement_receipt === null ||
      (typeof value.measurement_receipt === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.measurement_receipt)))
  );
}

export function parseSponsorFeedCampaigns(value: unknown): SponsorFeedCampaign[] {
  if (!isRecord(value) || !Array.isArray(value.campaigns)) return [];
  return value.campaigns.filter(isSponsorFeedCampaign).slice(0, 5);
}

/**
 * Sponsor inventory is public and can be delivered to signed-out visitors.
 * Measurement consent controls tracking, not whether the card is eligible.
 * The optional legacy argument is intentionally ignored for compatibility.
 */
export function shouldInsertSponsorCard(topicsSinceLastCard: number, _hasUser?: boolean): boolean {
  return (
    Number.isSafeInteger(topicsSinceLastCard) &&
    topicsSinceLastCard >= 0 &&
    topicsSinceLastCard + 1 >= SPONSOR_CARD_CADENCE
  );
}

export function getNextSponsorCadence(topicsSinceLastCard: number): number {
  if (!Number.isSafeInteger(topicsSinceLastCard) || topicsSinceLastCard < 0) return 0;
  return (topicsSinceLastCard + 1) % SPONSOR_CARD_CADENCE;
}
