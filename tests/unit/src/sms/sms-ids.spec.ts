import { SendSmsService } from '../../../../apps/sms/src/features/send-sms/send-sms.service';
import { MemorySmsStore } from '../../../../apps/sms/src/shared/sms-store';

const SMS_ID = /^sms_[0-9a-hjkmnp-tv-z]{26}$/;
const owner = { tribeId: 'org-a', projectId: 'prj-a', serviceId: 'app-a', environment: 'test' as const } as never;

describe('APICenter SMS message IDs', () => {
  function service(providerMessageId = 'SM0123456789abcdef0123456789abcdef') {
    const store = new MemorySmsStore();
    const provider = { provider: 'twilio', defaultSenderId: undefined, hasPlatformSender: () => true, configured: () => true,
      send: jest.fn(async () => ({ providerMessageId, status: 'queued' as const })) };
    return { store, provider, sms: new SendSmsService(store, provider as never) };
  }

  it('returns an APICenter sms_ ID, never the provider\'s', async () => {
    const { sms } = service();
    const sent = await sms.execute({ to: '+639171234567', message: 'Hello' }, owner);
    expect(sent.messageId).toMatch(SMS_ID);
    expect(JSON.stringify(sent)).not.toContain('SM0123456789abcdef');
  });

  it('applies a delivery callback for a new message through the provider message ID', async () => {
    const { sms, store } = service('SMfeedface');
    const { messageId } = await sms.execute({ to: '+639171234567', message: 'Hello' }, owner);
    await expect(store.applyDeliveryEvent({ providerEventId: 'evt-1', provider: 'twilio', providerMessageId: 'SMfeedface', status: 'delivered', payload: {} }))
      .resolves.toEqual({ duplicate: false });
    await expect(store.findById(messageId, owner)).resolves.toMatchObject({ messageId, status: 'delivered' });
    await expect(store.applyDeliveryEvent({ providerEventId: 'evt-2', provider: 'twilio', providerMessageId: 'SMunknown', status: 'delivered', payload: {} }))
      .rejects.toThrow('not yet recorded');
  });
});
