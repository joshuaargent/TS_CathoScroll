import { createServiceRoleClient } from '@/lib/supabase/admin';

export type StoredAnalyticsConsent = {
  serviceImprovement: boolean;
  sponsorMeasurement: boolean;
  updatedAt: string | null;
  version: number;
  exists: boolean;
  personalizationEnabled: boolean;
};

export async function getStoredAnalyticsConsent(userId: string): Promise<StoredAnalyticsConsent> {
  const { data, error } = await createServiceRoleClient().rpc('get_user_analytics_consent', {
    p_user_id: userId,
  });
  if (error) throw new Error('Unable to read the account analytics consent record.');
  if (typeof data !== 'object' || data === null) {
    throw new Error('The account analytics consent response is invalid.');
  }
  const value = data as Record<string, unknown>;
  if (
    typeof value.serviceImprovement !== 'boolean' ||
    typeof value.sponsorMeasurement !== 'boolean' ||
    !(value.updatedAt === null || typeof value.updatedAt === 'string') ||
    typeof value.version !== 'number' ||
    typeof value.exists !== 'boolean' ||
    typeof value.personalizationEnabled !== 'boolean'
  ) throw new Error('The account analytics consent response is invalid.');
  // Old consent versions do not authorise collection under the revised
  // disclosures. Treat them as undecided until the account makes a new choice.
  const currentConsent = value.version === 2 && value.exists === true;
  return {
    serviceImprovement: currentConsent && value.serviceImprovement,
    sponsorMeasurement: currentConsent && value.sponsorMeasurement,
    updatedAt: currentConsent ? value.updatedAt : null,
    version: 2,
    exists: currentConsent,
    personalizationEnabled: value.personalizationEnabled,
  };
}
