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

describe('SubscriptionService targeted addon expiry recompute', () => {
  const createService = () => {
    const service = Object.create(SubscriptionService.prototype) as any;
    service.subscriptionAddonService = {
      markExpiredAddonsAndGetAffectedSubscriptions: jest.fn(),
    };
    service.SubscriptionModel = {
      aggregate: jest.fn(),
    };
    return service;
  };

  it('returns no-op when no affected subscriptions expire', async () => {
    const service = createService();
    service.subscriptionAddonService.markExpiredAddonsAndGetAffectedSubscriptions.mockResolvedValue(
      [],
    );
    const updateSpy = jest.spyOn(
      service as any,
      'updateSubscriptionAddonsForSubscriptions',
    );

    const result = await service.expireAndRecomputeAffectedSubscriptionAddons();

    expect(result).toEqual([]);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('recomputes only affected subscriptions returned by expiry step', async () => {
    const service = createService();
    service.subscriptionAddonService.markExpiredAddonsAndGetAffectedSubscriptions.mockResolvedValue(
      ['sub1', 'sub2'],
    );
    const updateSpy = jest
      .spyOn(service as any, 'updateSubscriptionAddonsForSubscriptions')
      .mockResolvedValue([{ _id: 'sub1' }]);

    const result = await service.expireAndRecomputeAffectedSubscriptionAddons();

    expect(updateSpy).toHaveBeenCalledWith(['sub1', 'sub2']);
    expect(result).toEqual([{ _id: 'sub1' }]);
  });

  it('skips aggregate when targeted IDs are empty', async () => {
    const service = createService();

    const result = await service.updateSubscriptionAddonsForSubscriptions([]);

    expect(result).toEqual([]);
    expect(service.SubscriptionModel.aggregate).not.toHaveBeenCalled();
  });

  it('builds targeted aggregate for valid subscription IDs only', async () => {
    const service = createService();
    const exec = jest.fn().mockResolvedValue([{ ok: true }]);
    service.SubscriptionModel.aggregate.mockReturnValue({ exec });

    const result = await service.updateSubscriptionAddonsForSubscriptions([
      '507f1f77bcf86cd799439011',
      'invalid-object-id',
    ]);

    expect(result).toEqual([{ ok: true }]);
    expect(service.SubscriptionModel.aggregate).toHaveBeenCalledTimes(1);
    const [pipeline] = service.SubscriptionModel.aggregate.mock.calls[0];
    expect(pipeline[0].$match._id.$in).toHaveLength(1);
  });
});

describe('SubscriptionService razorpay grace lifecycle', () => {
  const createService = () => {
    const service = Object.create(SubscriptionService.prototype) as any;
    service.SubscriptionModel = {
      findOne: jest.fn(),
      find: jest.fn(),
    };
    service.addonPurchaseService = {
      syncProviderSubscriptionStatus: jest.fn(),
    };
    service.userService = {
      updateClient: jest.fn(),
      deactivateUserByAdminId: jest.fn(),
    };
    return service;
  };

  it('marks payment failed and opens grace window', async () => {
    const service = createService();
    const save = jest.fn();
    const subDoc: any = {
      admin: { toString: () => 'admin_1' },
      razorpayPaymentFailureCount: 1,
      save,
    };
    service.SubscriptionModel.findOne.mockResolvedValue(subDoc);

    await service.handleSubscriptionPaymentFailed('sub_123', { id: 'pay_1' });

    expect(subDoc.razorpaySubscriptionStatus).toBe('payment_failed');
    expect(subDoc.razorpayPaymentFailureCount).toBe(2);
    expect(subDoc.razorpayGraceUntil).toBeInstanceOf(Date);
    expect(service.userService.updateClient).toHaveBeenCalledWith('admin_1', {
      isActive: true,
    });
    expect(service.addonPurchaseService.syncProviderSubscriptionStatus).toHaveBeenCalledWith(
      'sub_123',
      'payment_failed',
    );
    expect(save).toHaveBeenCalled();
  });

  it('deactivates users whose grace window has expired', async () => {
    const service = createService();
    const save1 = jest.fn();
    const save2 = jest.fn();
    service.SubscriptionModel.find.mockResolvedValue([
      { admin: 'a1', save: save1 },
      { admin: 'a2', save: save2 },
    ]);

    const result = await service.processRazorpayGraceExpiries();

    expect(result).toEqual({ checked: 2, deactivated: 2 });
    expect(save1).toHaveBeenCalled();
    expect(save2).toHaveBeenCalled();
    expect(service.userService.deactivateUserByAdminId).toHaveBeenCalledTimes(2);
  });
});
