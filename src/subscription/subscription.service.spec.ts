import { SubscriptionService } from './subscription.service';

describe('SubscriptionService.generatePriceForAddon', () => {
  const createService = (gstValue: number) => {
    const service = Object.create(
      SubscriptionService.prototype,
    ) as SubscriptionService & { GST_VALUE: number };
    service.GST_VALUE = gstValue;
    return service;
  };

  it('returns unchanged totals when GST is zero', () => {
    const service = createService(0);

    const result = service.generatePriceForAddon(100);

    expect(result).toEqual({
      itemAmount: 100,
      taxAmount: 0,
      totalAmount: 100,
    });
  });

  it('treats add-on amount as GST-inclusive when GST is non-zero', () => {
    const service = createService(18);

    const result = service.generatePriceForAddon(100);

    expect(result).toEqual({
      itemAmount: 84.75,
      taxAmount: 15.25,
      totalAmount: 100,
    });
  });
});
