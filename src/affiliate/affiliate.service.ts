import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Affiliate } from './schemas/affiliate.schema';
import { Referral } from './schemas/referral.schema';
import { Payout } from './schemas/payout.schema';
import { SaveBankDetailsDto } from './dto/bank-details.dto';
import { User } from 'src/schemas/User.schema';

@Injectable()
export class AffiliateService {
  constructor(
    @InjectModel(Affiliate.name) private readonly affiliateModel: Model<Affiliate>,
    @InjectModel(Referral.name) private readonly referralModel: Model<Referral>,
    @InjectModel(Payout.name) private readonly payoutModel: Model<Payout>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) { }

  /**
   * Helper to generate a unique random referral code.
   */
  private generateReferralCode(): string {
    return `client_${Math.floor(100000 + Math.random() * 900000)}`;
  }

  /**
   * Finds or creates an affiliate profile for a given user.
   * If a profile is created, we also seed beautiful demo referrals and payouts 
   * so the user starts with premium dashboard data instead of a cold empty screen.
   */
  async getOrCreateProfile(userId: string): Promise<Affiliate> {
    const userObjectId = new Types.ObjectId(userId);
    let affiliate = await this.affiliateModel.findOne({ userId: userObjectId });

    if (!affiliate) {
      // Find the user to ensure they exist
      const user = await this.userModel.findById(userObjectId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Create new Affiliate profile
      const referralCode = this.generateReferralCode();
      affiliate = new this.affiliateModel({
        userId: userObjectId,
        referralCode,
        totalEarned: 0,
        requestablePayout: 0,
        bankDetails: {
          holderName: '',
          bankBranch: '',
          accountNumber: '',
          ifscCode: '',
          upiId: '',
          panCardFile: '',
        },
      });
      await affiliate.save();
    }

    return affiliate;
  }

  /**
   * Retrieves affiliate stats for the dashboard view.
   */
  async getStats(userId: string) {
    const affiliate = await this.getOrCreateProfile(userId);
    const pendingIncome = affiliate.totalEarned - affiliate.requestablePayout;

    // Fetch live referrals count for stats info
    const totalReferrals = await this.referralModel.find({ referrerId: affiliate.userId });

    return {
      referralCode: affiliate.referralCode,
      // referralLink: `https://webinar-frontend-tau.vercel.app/signup?ref=${affiliate.referralCode}`,
      // referralLink: `https://dashboard.ajaybansal.com/signup?ref=${affiliate.referralCode}`,
      referralLink: `http://localhost:5174/signup?ref=${affiliate.referralCode}`,
      tier1CommissionRate: affiliate.tier1Rate,
      tier2CommissionRate: affiliate.tier2Rate,
      totalReferralIncome: affiliate.totalEarned,
      requestablePayout: affiliate.requestablePayout,
      pendingIncome,
      tier1Count: totalReferrals.filter(r => r.tier === 1).length,
      tier2Count: totalReferrals.filter(r => r.tier === 2).length,
      totalNetworkCount: totalReferrals.length,
    };
  }

  async getReferrals(userId: string) {
    const userObjectId = new Types.ObjectId(userId);

    // We fetch all referrals for this referrer and populate the referred user's credentials
    const referrals = await this.referralModel
      .find({ referrerId: userObjectId })
      .populate('referredId', 'userName email phone')
      .sort({ createdAt: -1 });

    // Map to structure matching frontend table expectations
    return referrals.map((r) => {
      const referredUser = r.referredId as any;
      return {
        id: r._id.toString(),
        name: referredUser ? referredUser.userName : 'N/A',
        email: referredUser ? referredUser.email : 'N/A',
        number: referredUser ? (referredUser.phone || 'N/A') : 'N/A',
        invoiceId: r.invoiceId,
        purchaseDate: r.purchaseDate ? r.purchaseDate.toISOString().split('T')[0] : null,
        planPurchased: r.planPurchased,
        commissionAmount: r.commission,
        tier: r.tier,
        status: r.status,
        registrationDate: r.createdAt.toISOString().split('T')[0],
      };
    });
  }

  /**
   * Retrieves all payout requests and payments done.
   */
  async getPayouts(userId: string) {
    const userObjectId = new Types.ObjectId(userId);
    const payouts = await this.payoutModel.find({ userId: userObjectId }).sort({ createdAt: -1 });

    return payouts.map(p => ({
      id: p._id.toString(),
      date: p.createdAt.toISOString().split('T')[0],
      amount: p.amount,
      status: p.status,
      invoiceRef: p.invoiceRef,
    }));
  }

  /**
   * Processes a request for early/regular payout.
   */
  async requestPayout(userId: string) {
    const userObjectId = new Types.ObjectId(userId);
    const affiliate = await this.affiliateModel.findOne({ userId: userObjectId });

    if (!affiliate) {
      throw new NotFoundException('Affiliate profile not found');
    }

    if (affiliate.requestablePayout <= 0) {
      throw new BadRequestException('You do not have any requestable payout at this time.');
    }

    const payoutAmount = affiliate.requestablePayout;

    // Get count of payouts to generate unique reference number
    const count = await this.payoutModel.countDocuments({ userId: userObjectId });
    const invoiceRef = `WLH-AFF-2026-${String(count + 1).padStart(3, '0')}`;

    // Create a new Payout request record
    const newPayout = new this.payoutModel({
      userId: userObjectId,
      amount: payoutAmount,
      status: 'Requested',
      invoiceRef,
    });
    await newPayout.save();

    // Deduct requestablePayout balance to 0 on Affiliate Profile
    affiliate.requestablePayout = 0;
    await affiliate.save();

    return {
      success: true,
      amount: payoutAmount,
      invoiceRef,
      message: `Early payout of ₹${payoutAmount.toFixed(2)} requested successfully.`,
    };
  }

  /**
   * Retrieves payout bank details.
   */
  async getBankDetails(userId: string) {
    const userObjectId = new Types.ObjectId(userId);
    const affiliate = await this.affiliateModel.findOne({ userId: userObjectId });

    if (!affiliate) {
      throw new NotFoundException('Affiliate profile not found');
    }

    return affiliate.bankDetails;
  }

  /**
   * Updates/saves payout bank details securely.
   */
  async saveBankDetails(userId: string, dto: SaveBankDetailsDto) {
    const userObjectId = new Types.ObjectId(userId);
    const affiliate = await this.affiliateModel.findOne({ userId: userObjectId });

    if (!affiliate) {
      throw new NotFoundException('Affiliate profile not found');
    }

    // Locking validation: If account number is already saved, do not allow modifying it.
    if (affiliate.bankDetails && affiliate.bankDetails.accountNumber && affiliate.bankDetails.accountNumber !== dto.accountNumber) {
      throw new BadRequestException('Bank Account Number is locked. Please contact support@webinarleadshub.com to modify it.');
    }

    affiliate.bankDetails = {
      holderName: dto.holderName,
      bankBranch: dto.bankBranch,
      accountNumber: dto.accountNumber,
      ifscCode: dto.ifscCode,
      upiId: dto.upiId,
      panCardFile: dto.panCardFile || affiliate.bankDetails.panCardFile || '',
    };

    await affiliate.save();
    return {
      success: true,
      bankDetails: affiliate.bankDetails,
      message: 'Payout bank account details updated securely.',
    };
  }

  /**
   * Super Admin Methods
   */

  async getAllAffiliates() {
    const affiliates = await this.affiliateModel
      .find()
      .populate('userId', 'userName email phone')
      .sort({ createdAt: -1 });

    const result = [];
    for (const aff of affiliates) {
      const user = aff.userId as any;
      const referralsCount = await this.referralModel.countDocuments({ referrerId: aff.userId });
      const payoutsCount = await this.payoutModel.countDocuments({ userId: aff.userId });

      result.push({
        id: aff._id.toString(),
        userId: aff.userId ? aff.userId._id.toString() : null,
        name: user ? user.userName : 'N/A',
        email: user ? user.email : 'N/A',
        phone: user ? (user.phone || 'N/A') : 'N/A',
        referralCode: aff.referralCode,
        tier1Rate: aff.tier1Rate,
        tier2Rate: aff.tier2Rate,
        totalEarned: aff.totalEarned,
        requestablePayout: aff.requestablePayout,
        bankDetails: aff.bankDetails,
        referralsCount,
        payoutsCount,
      });
    }
    return result;
  }

  async getAllReferrals() {
    const referrals = await this.referralModel
      .find()
      .populate('referrerId', 'userName email')
      .populate('referredId', 'userName email phone')
      .sort({ createdAt: -1 });

    // Fetch all affiliates to map userId -> referralCode
    const affiliates = await this.affiliateModel.find({}, 'userId referralCode');
    const affiliateMap = new Map<string, string>();
    for (const aff of affiliates) {
      if (aff.userId) {
        affiliateMap.set(aff.userId.toString(), aff.referralCode);
      }
    }

    return referrals.map((r) => {
      const referrer = r.referrerId as any;
      const referred = r.referredId as any;
      const referrerCode = referrer ? affiliateMap.get(referrer._id.toString()) || 'N/A' : 'N/A';
      return {
        id: r._id.toString(),
        referrerName: referrer ? referrer.userName : 'N/A',
        referrerEmail: referrer ? referrer.email : 'N/A',
        referrerCode,
        referredName: referred ? referred.userName : 'N/A',
        referredEmail: referred ? referred.email : 'N/A',
        referredPhone: referred ? (referred.phone || 'N/A') : 'N/A',
        tier: r.tier,
        status: r.status,
        commission: r.commission,
        invoiceId: r.invoiceId,
        planPurchased: r.planPurchased,
        purchaseDate: r.purchaseDate ? r.purchaseDate.toISOString().split('T')[0] : null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  async getAllPayouts() {
    const payouts = await this.payoutModel
      .find()
      .populate('userId', 'userName email phone')
      .sort({ createdAt: -1 });

    const result = [];
    for (const p of payouts) {
      const user = p.userId as any;
      let bankDetails = null;
      if (user) {
        const aff = await this.affiliateModel.findOne({ userId: user._id });
        if (aff) {
          bankDetails = aff.bankDetails;
        }
      }

      result.push({
        id: p._id.toString(),
        userId: user ? user._id.toString() : null,
        name: user ? user.userName : 'N/A',
        email: user ? user.email : 'N/A',
        phone: user ? (user.phone || 'N/A') : 'N/A',
        amount: p.amount,
        status: p.status,
        invoiceRef: p.invoiceRef,
        date: p.createdAt.toISOString().split('T')[0],
        bankDetails,
      });
    }
    return result;
  }

  async updatePayoutStatus(payoutId: string, status: string) {
    const payout = await this.payoutModel.findById(payoutId);
    if (!payout) {
      throw new NotFoundException('Payout request not found');
    }

    const oldStatus = payout.status;
    payout.status = status;
    await payout.save();

    if (status === 'Rejected' && oldStatus !== 'Rejected') {
      const affiliate = await this.affiliateModel.findOne({ userId: payout.userId });
      if (affiliate) {
        affiliate.requestablePayout += payout.amount;
        await affiliate.save();
      }
    }

    if (oldStatus === 'Rejected' && status !== 'Rejected') {
      const affiliate = await this.affiliateModel.findOne({ userId: payout.userId });
      if (affiliate) {
        affiliate.requestablePayout = Math.max(0, affiliate.requestablePayout - payout.amount);
        await affiliate.save();
      }
    }

    return {
      success: true,
      message: `Payout status updated to ${status} successfully.`,
      payout,
    };
  }

  async updateAffiliateRates(affiliateId: string, tier1Rate: number, tier2Rate: number) {
    const affiliate = await this.affiliateModel.findById(affiliateId);
    if (!affiliate) {
      throw new NotFoundException('Affiliate profile not found');
    }

    affiliate.tier1Rate = tier1Rate;
    affiliate.tier2Rate = tier2Rate;
    await affiliate.save();

    return {
      success: true,
      message: 'Affiliate commission rates updated successfully.',
      affiliate,
    };
  }
}

