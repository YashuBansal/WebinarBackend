import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppGateway } from './whatsapp.gateway';

@Injectable()
export class WebsocketService {
  private readonly logger = new Logger(WebsocketService.name);
  constructor(private readonly waGateway: WhatsAppGateway) {}

  emitChatMessage(
    userId: string,
    evt: {
      phoneNumber: string;
      textBody?: string;
      direction: 'inbound' | 'outbound';
      createdAt?: string;
    },
  ) {
    const payload = {
      ...evt,
      createdAt: evt.createdAt ?? new Date().toISOString(),
    };
    const userIdStr = String(userId);
    const roomName = `user:${userIdStr}`;
    
    // Check if user is active (optional, for logging)
    const socketId = this.waGateway.activeUsers.get(userIdStr);
    if (!socketId) {
      this.logger.warn(`No active socket for user ${userIdStr}, but emitting to room ${roomName} anyway`);
    }
    
    // Emit to room (works even if client reconnects - they'll rejoin the same room)
    this.waGateway.server.to(roomName).emit('chat-message', payload);
    this.logger.debug(`Emitted chat-message to room ${roomName} for user ${userIdStr}`);
  }
}


