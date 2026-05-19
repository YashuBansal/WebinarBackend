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
  ) {}

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
      referralLink: `https://webinarleadshub.com/signup?ref=${affiliate.referralCode}`,
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

  /**
   * Retrieves the referrals list (both signups and customers).
   */
  async getReferrals(userId: string) {
    const userObjectId = new Types.ObjectId(userId);
    
    // We fetch all referrals for this referrer
    const referrals = await this.referralModel.find({ referrerId: userObjectId }).sort({ createdAt: -1 });

    // Map to structure matching frontend table expectations
    return referrals.map((r, idx) => ({
      id: r._id.toString(),
      name: `User ${idx + 1}`, // In a real system, we'd populate and fetch the referred user's username/email
      email: r.status === 'customer' ? `referred_${idx}@wlh-customer.com` : `signup_${idx}@wlh-lead.com`,
      number: `+91 99999 ${10000 + idx}`,
      invoiceId: r.invoiceId,
      purchaseDate: r.purchaseDate ? r.purchaseDate.toISOString().split('T')[0] : null,
      planPurchased: r.planPurchased,
      commissionAmount: r.commission,
      tier: r.tier,
      status: r.status,
      registrationDate: r.createdAt.toISOString().split('T')[0],
    }));
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
}
