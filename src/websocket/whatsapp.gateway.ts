import { Logger, UseFilters } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WebsocketExceptionFilter } from './ws-exception.filter';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true, // Allow cookies
  },
  transports: ['websocket'],
})
@UseFilters(new WebsocketExceptionFilter())
export class WhatsAppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(WhatsAppGateway.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  @WebSocketServer()
  public server: Server;

  // userId -> socketId
  public activeUsers = new Map<string, string>();

  async handleConnection(client: Socket) {
    this.logger.log(`WhatsApp WS client connected: ${client.id}`);
    
    // Read token from cookies
    const cookieHeader = client.handshake.headers.cookie;
    if (!cookieHeader) {
      this.logger.warn(`No cookies found for client ${client.id}, disconnecting`);
      client.disconnect();
      return;
    }

    // Parse cookies
    const cookies = this.parseCookies(cookieHeader);
    const accessTokenName = this.configService.get('ACCESS_TOKEN_NAME');
    const token = cookies[accessTokenName];
    console.log('token ------------------------- > ', token);

    if (!token) {
      this.logger.warn(`No access token found in cookies for client ${client.id}, disconnecting`);
      client.disconnect();
      return;
    }

    try {
      // Validate token
      const secret = this.configService.get('ACCESS_TOKEN_SECRET');
      const decodedToken = this.jwtService.verify(token, { secret });
      
      // Extract userId from token
      const userId = String(decodedToken.id || decodedToken.adminId);
      
      // Store userId in socket data for later use
      client.data.userId = userId;
      
      // Automatically join user room based on authenticated userId
      const roomName = `user:${userId}`;
      client.join(roomName);
      this.activeUsers.set(userId, client.id);
      
      this.logger.log(`Client ${client.id} authenticated as user ${userId} and joined room ${roomName}`);
      
    } catch (error) {
      this.logger.error(`Token validation failed for client ${client.id}:`, error);
      client.disconnect();
    }
  }

  private parseCookies(cookieHeader: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!cookieHeader) return cookies;

    cookieHeader.split(';').forEach((cookie) => {
      const [name, ...rest] = cookie.trim().split('=');
      if (name) {
        cookies[name] = rest.join('=');
      }
    });

    return cookies;
  }

  handleDisconnect(client: Socket) {
    const userId = [...this.activeUsers.entries()].find(
      ([, socketId]) => socketId === client.id,
    )?.[0];

    if (userId) {
      this.activeUsers.delete(userId);
      this.logger.log(`WhatsApp WS user ${userId} disconnected`);
    }
  }

  // Note: No explicit join handler needed - user is automatically joined to their room
  // during connection based on authenticated token. This keeps it simpler and more secure.
  emitToUser(userId: string, payload: {
    phoneNumber: string;
    textBody?: string;
    direction: 'inbound' | 'outbound';
    createdAt?: string;
  }) {

    console.log('payload ------------------------- > ', payload);
    const room = `user:${String(userId)}`;
    this.server.to(room).emit('chat-message', {
      ...payload,
      createdAt: payload.createdAt ?? new Date().toISOString(),
    });
  }
}


