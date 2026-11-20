import { redirect } from 'next/navigation';

export default function PersonalizationSettingsRedirect() {
  redirect('/account#personalization');
}
