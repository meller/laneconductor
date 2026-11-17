// Fake secrets and personal data for the privacy-scan tests, assembled at run time so no file in the
// repo contains a scannable secret.
export const FAKES = {
  'GitHub token': `${'gh'}p_${'a1B2c3D4e5F6g7H8i9J0k1L2m3'}`,
  'GitHub token (fine-grained)': `${'github'}_pat_${'A1b2C3d4E5f6G7h8I9j0K1l2'}`,
  'Anthropic or OpenAI key': `${'s'}k-${'abcdefghijklmnopqrstuvwx0123'}`,
  'AWS access key': `${'AK'}IA${'ABCDEFGHIJKLMNOP'}`,
  'Slack token': `${'xo'}xb-${'1234567890-abcdefghij'}`,
  'Google API key': `${'AI'}za${'SyA1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q'}`,
  'private key block': `-----BEGIN ${'RSA PRIV'}ATE KEY-----`,
  'bearer token': `${'Bear'}er ${'abcdefghijklmnopqrstuvwxyz012345'}`,
  'connection string with password': `${'post'}gres://svc:${'s3cr3tpw'}@db.prod.example.org:5432/app`,
  'credential assignment': `${'pass'}word = ${'hunter2hunter2'}`,
  'email address': `${'asaf.test'}@${'gmail'}.com`,
  'phone number': '054-123-4567',
};
