import { AddonPurchaseService } from './addon-purchase.service';
import { BadRequestException } from '@nestjs/common';

describe('AddonPurchaseService', () => {
  const addonPurchaseModel = {
    findOne: jest.fn(),
    create: jest.fn(),
    findById: jest.fn(),
    updateOne: jest.fn(),
  };

  const subscriptionService = {
    getSubscription: jest.fn().mockResolvedValue({
      _id: '507f1f77bcf86cd799439055',
      expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }),
    generatePriceForAddon: jest.fn().mockReturnValue({
      itemAmount: 84.75,
      taxAmount: 15.25,
      totalAmount: 100,
    }),
    GST_VALUE: 18,
    updateSingleSubscriptionAddon: jest.fn(),
  };

  const addonService = {
    getAddOnById: jest.fn().mockResolvedValue({
      _id: 'addon1',
      addOnPrice: 100,
      validityInDays: 7,
      employeeLimit: 0,
      contactLimit: 0,
      webinarLimit: 0,
      addonName: 'Test',
      isActive: true,
      razorpayPlanId: 'plan_test123',
    }),
  };

  const razorpayService = {
    createAddonSubscription: jest.fn().mockResolvedValue({
      result: { id: 'sub_1' },
      addonData: { addonName: 'Test' },
    }),
  };

  const subscriptionAddonService = {
    createSubscriptionAddon: jest.fn(),
    getUserAddonByPurchaseId: jest.fn(),
    setSubscriptionAddonExpiryByPurchaseId: jest.fn(),
  };

  const billingHistoryService = {
    addOneBillingHistory: jest.fn(),
    getByAddonPurchaseId: jest.fn(),
    findByRazorpayPaymentId: jest.fn(),
  };

  const usersService = {
    getUserById: jest.fn().mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      isActive: true,
    }),
  };

  const connection = {
    startSession: jest.fn(),
  };

  let service: AddonPurchaseService;

  beforeEach(async () => {
    jest.clearAllMocks();
    service = new AddonPurchaseService(
      addonPurchaseModel as any,
      subscriptionService as any,
      addonService as any,
      razorpayService as any,
      subscriptionAddonService as any,
      billingHistoryService as any,
      usersService as any,
      connection as any,
    );
  });

  it('requires Idempotency-Key', async () => {
    await expect(
      service.createRazorpayPurchaseOrder({
        adminId: '507f1f77bcf86cd799439011',
        addonId: '507f1f77bcf86cd799439012',
        idempotencyKey: '   ',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is idempotent by (admin,idempotencyKey)', async () => {
    addonPurchaseModel.findOne.mockResolvedValue({
      _id: 'p1',
      providerRazorpaySubscriptionId: 'sub_1',
      amount: 118,
      currency: 'INR',
    });

    const res = await service.createRazorpayPurchaseOrder({
      adminId: '507f1f77bcf86cd799439011',
      addonId: '507f1f77bcf86cd799439012',
      idempotencyKey: 'key-1',
    });

    expect(res.purchase._id).toBe('p1');
    expect(addonPurchaseModel.create).not.toHaveBeenCalled();
  });

  it('finalize tolerates duplicate billing (E11000)', async () => {
    const session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn(),
      endSession: jest.fn(),
    };
    connection.startSession.mockResolvedValue(session);

    const purchaseDoc: any = {
      _id: '507f1f77bcf86cd799439099',
      admin: '507f1f77bcf86cd799439011',
      subscription: '507f1f77bcf86cd799439055',
      addon: '507f1f77bcf86cd799439012',
      provider: 'razorpay',
      providerOrderId: 'order_1',
      status: 'PENDING_PAYMENT',
      save: jest.fn().mockResolvedValue(undefined),
    };

    billingHistoryService.findByRazorpayPaymentId.mockResolvedValue(null);
    addonPurchaseModel.findOne.mockImplementation((f: any) => {
      if (f?.status?.$ne) {
        return {
          session: () => Promise.resolve(purchaseDoc),
        };
      }
      return Promise.resolve(purchaseDoc);
    });

    subscriptionAddonService.createSubscriptionAddon.mockResolvedValue({});

    billingHistoryService.addOneBillingHistory.mockRejectedValue(
      new Error('E11000 duplicate key error collection'),
    );

    await expect(
      service.finalizeRazorpayAddonPurchase({
        providerOrderId: 'order_1',
        providerPaymentId: 'pay_1',
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('finalize returns idempotent when billing already exists for payment', async () => {
    billingHistoryService.findByRazorpayPaymentId.mockResolvedValue({
      addonPurchase: '507f1f77bcf86cd799439099',
    } as any);
    addonPurchaseModel.findOne.mockResolvedValue({
      _id: '507f1f77bcf86cd799439099',
      admin: '507f1f77bcf86cd799439011',
      subscription: '507f1f77bcf86cd799439055',
      addon: '507f1f77bcf86cd799439012',
      provider: 'razorpay',
      providerRazorpaySubscriptionId: 'sub_addon',
      status: 'APPLIED',
    });
    addonPurchaseModel.updateOne.mockResolvedValue({});

    const res = await service.finalizeRazorpayAddonPurchase({
      providerRazorpaySubscriptionId: 'sub_addon',
      providerPaymentId: 'pay_first',
    });

    expect(res).toMatchObject({ ok: true, idempotent: true });
    expect(subscriptionAddonService.createSubscriptionAddon).not.toHaveBeenCalled();
  });

  it('applyAddonRenewal extends expiry and records billing for new payment id', async () => {
    billingHistoryService.findByRazorpayPaymentId.mockResolvedValue(null);
    subscriptionAddonService.getUserAddonByPurchaseId.mockResolvedValue({
      expiryDate: new Date('2030-01-01'),
    });
    billingHistoryService.addOneBillingHistory.mockResolvedValue({});

    const purchase: any = {
      _id: '507f1f77bcf86cd799439099',
      admin: '507f1f77bcf86cd799439011',
      subscription: '507f1f77bcf86cd799439055',
      addon: '507f1f77bcf86cd799439012',
      status: 'APPLIED',
      providerRazorpaySubscriptionId: 'sub_addon',
    };

    const res = await service.applyAddonRenewalFromSubscriptionCharge(
      purchase,
      'pay_renew_1',
    );

    expect(res).toMatchObject({ ok: true, renewed: true });
    expect(
      subscriptionAddonService.setSubscriptionAddonExpiryByPurchaseId,
    ).toHaveBeenCalled();
    expect(billingHistoryService.addOneBillingHistory).toHaveBeenCalled();
    expect(subscriptionService.updateSingleSubscriptionAddon).toHaveBeenCalled();
  });

  it('applyAddonRenewal is idempotent for duplicate pay id', async () => {
    billingHistoryService.findByRazorpayPaymentId.mockResolvedValue({
      _id: 'bill1',
    } as any);
    const purchase: any = {
      _id: '507f1f77bcf86cd799439099',
      admin: '507f1f77bcf86cd799439011',
      subscription: '507f1f77bcf86cd799439055',
      addon: '507f1f77bcf86cd799439012',
      status: 'APPLIED',
    };

    const res = await service.applyAddonRenewalFromSubscriptionCharge(
      purchase,
      'pay_dup',
    );

    expect(res).toMatchObject({ ok: true, renewed: false });
    expect(
      subscriptionAddonService.setSubscriptionAddonExpiryByPurchaseId,
    ).not.toHaveBeenCalled();
  });
});
