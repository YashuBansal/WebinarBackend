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
  };

  const billingHistoryService = {
    addOneBillingHistory: jest.fn(),
    getByAddonPurchaseId: jest.fn(),
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
      save: jest.fn(),
    };

    addonPurchaseModel.findOne.mockReturnValue({
      session: () => purchaseDoc,
    });

    billingHistoryService.addOneBillingHistory.mockRejectedValue(
      new Error('E11000 duplicate key error collection'),
    );

    await expect(
      service.finalizeRazorpayAddonPurchase({
        providerOrderId: 'order_1',
        providerPaymentId: 'pay_1',
      }),
    ).resolves.toBeTruthy();
  });
});
