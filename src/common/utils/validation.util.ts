import { BadRequestException } from '@nestjs/common';

export class ValidationUtil {
  /**
   * Validates and sanitizes phone number
   */
  static validatePhoneNumber(phone: string): string {
    if (!phone) {
      throw new BadRequestException('Phone number is required');
    }

    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, '');

    // Basic validation - should be between 7-15 digits
    if (cleaned.length < 7 || cleaned.length > 15) {
      throw new BadRequestException('Invalid phone number format');
    }

    return cleaned;
  }

  /**
   * Validates and sanitizes email address
   */
  static validateEmail(email: string): string {
    if (!email) {
      throw new BadRequestException('Email is required');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestException('Invalid email format');
    }

    return email.toLowerCase().trim();
  }

  /**
   * Sanitizes text input to prevent XSS and injection attacks
   */
  static sanitizeText(text: string): string {
    if (!text) return '';

    return text
      .trim()
      .replace(/[<>]/g, '') // Remove potential HTML tags
      .replace(/['"]/g, '') // Remove quotes to prevent injection
      .substring(0, 1000); // Limit length
  }

  /**
   * Validates ObjectId format
   */
  static validateObjectId(id: string, fieldName: string = 'ID'): string {
    if (!id) {
      throw new BadRequestException(`${fieldName} is required`);
    }

    const objectIdRegex = /^[0-9a-fA-F]{24}$/;
    if (!objectIdRegex.test(id)) {
      throw new BadRequestException(`Invalid ${fieldName} format`);
    }

    return id;
  }

  /**
   * Validates template name
   */
  static validateTemplateName(name: string): string {
    if (!name) {
      throw new BadRequestException('Template name is required');
    }

    const sanitized = this.sanitizeText(name);
    if (sanitized.length < 1 || sanitized.length > 100) {
      throw new BadRequestException(
        'Template name must be between 1-100 characters',
      );
    }

    return sanitized;
  }

  /**
   * Validates webhook payload structure
   */
  static validateWebhookPayload(payload: any): void {
    if (!payload) {
      throw new BadRequestException('Webhook payload is required');
    }

    if (!payload.event) {
      throw new BadRequestException('Webhook event is required');
    }

    if (!payload.payload && !payload.object) {
      throw new BadRequestException(
        'Webhook payload must contain payload or object',
      );
    }
  }

  /**
   * Validates contact data structure
   */
  static validateContactData(contact: any): void {
    if (!contact) {
      throw new BadRequestException('Contact data is required');
    }

    if (!contact.phone && !contact.email) {
      throw new BadRequestException('Contact must have phone or email');
    }

    if (contact.phone) {
      this.validatePhoneNumber(contact.phone);
    }

    if (contact.email) {
      this.validateEmail(contact.email);
    }
  }

  /**
   * Validates configured template data
   */
  static validateConfiguredTemplate(template: any): void {
    if (!template) {
      throw new BadRequestException('Template data is required');
    }

    if (!template.templateName) {
      throw new BadRequestException('Template name is required');
    }

    if (!template.configuredTemplateName) {
      throw new BadRequestException('Configured template name is required');
    }

    this.validateTemplateName(template.templateName);
    this.validateTemplateName(template.configuredTemplateName);

    if (template.variableMappings && Array.isArray(template.variableMappings)) {
      template.variableMappings.forEach((mapping: any, index: number) => {
        if (!mapping.variable) {
          throw new BadRequestException(
            `Variable mapping ${index} must have a variable name`,
          );
        }

        if (mapping.isDynamic && !mapping.dynamicField) {
          throw new BadRequestException(
            `Dynamic variable ${index} must have a dynamic field`,
          );
        }

        if (!mapping.isDynamic && !mapping.staticValue) {
          throw new BadRequestException(
            `Static variable ${index} must have a static value`,
          );
        }
      });
    }
  }
}
