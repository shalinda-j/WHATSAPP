/**
 * Form-template seeder — intentionally a no-op.
 *
 * The previous version of this file inserted a hard-coded "Default
 * Registration Form" (Full Name / Age / Phone / Country / Experience /
 * Job Type / CV Link fields, English-language strings, Jayalath-style
 * welcome+completion messages) whenever the FormTemplate collection was
 * empty. That meant a deliberate `scripts/wipe_datasets.ts` run was undone
 * on the very next server boot.
 *
 * The operator explicitly asked for "no demo content ever again" — so the
 * sample template is no longer shipped. Forms must now be authored by
 * hand in Admin Panel > Form Builder. The function name + signature are
 * preserved so the index.ts boot sequence (`await
 * seedDefaultFormTemplate()`) doesn't need editing.
 */
export async function seedDefaultFormTemplate(): Promise<void> {
  // intentionally empty — no hard-coded form is ever inserted again
}

export default seedDefaultFormTemplate;
