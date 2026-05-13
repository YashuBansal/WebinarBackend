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

type ClientApp = 'zoom' | 'whatsapp' | 'unknown';

type ZoomRealtimeResource = 'meetings' | 'webinars';
type ZoomRealtimeAction = 'created' | 'updated' | 'deleted' | 'refetch';

interface ZoomRealtimePayload {
  resource: ZoomRealtimeResource;
  action: ZoomRealtimeAction;
  projectId: string;
  timestamp?: string;
}

interface ZoomRegistrantsUpdatePayload {
  projectId: string;
  meetingId: string;
  type: 'meeting' | 'webinar';
  timestamp?: string;
}

interface ZoomLiveUpdatePayload {
  projectId: string;
  meetingId: string;
  isWebinar: boolean;
  timestamp?: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true, // Allow cookies
  },
  transports: ['websocket'],
})
@UseFilters(new WebsocketExceptionFilter())
export class WhatsAppGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(WhatsAppGateway.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  @WebSocketServer()
  public server: Server;

  // userId -> socketId
  public activeUsers = new Map<string, string>();
  private readonly activeUsersByApp: Record<ClientApp, Map<string, string>> = {
    zoom: new Map(),
    whatsapp: new Map(),
    unknown: new Map(),
  };

  async handleConnection(client: Socket) {
    this.logger.log(`WS client connected: ${client.id}`);

    // Read token from cookies
    const cookieHeader = client.handshake.headers.cookie;
    if (!cookieHeader) {
      this.logger.warn(
        `No cookies found for client ${client.id}, disconnecting`,
      );
      client.disconnect();
      return;
    }

    // Parse cookies
    const cookies = this.parseCookies(cookieHeader);
    const accessTokenName = this.configService.get('ACCESS_TOKEN_NAME');
    const token = cookies[accessTokenName];

    if (!token) {
      this.logger.warn(
        `No access token found in cookies for client ${client.id}, disconnecting`,
      );
      client.disconnect();
      return;
    }

    try {
      // Validate token
      const secret = this.configService.get('ACCESS_TOKEN_SECRET');
      const decodedToken = this.jwtService.verify(token, { secret });

      // Extract userId from token
      const userId = String(decodedToken.id || decodedToken.adminId);
      const clientApp = this.getClientApp(client);

      // Store userId in socket data for later use
      client.data.userId = userId;
      client.data.clientApp = clientApp;

      // Automatically join user room based on authenticated userId
      const roomName = `user:${userId}`;
      client.join(roomName);
      this.activeUsers.set(userId, client.id);
      this.activeUsersByApp[clientApp].set(userId, client.id);

      this.logger.log(
        `Client ${client.id} (${clientApp}) authenticated as user ${userId} and joined room ${roomName}`,
      );
    } catch (error) {
      this.logger.error(
        `Token validation failed for client ${client.id}:`,
        error,
      );
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
    const userId: string | undefined = client.data.userId;
    const clientApp: ClientApp = client.data.clientApp ?? 'unknown';

    if (userId) {
      this.activeUsers.delete(userId);
      this.activeUsersByApp[clientApp]?.delete(userId);
      this.logger.log(`WS user ${userId} (${clientApp}) disconnected`);
      return;
    }

    // Fallback cleanup if userId was not stored for some reason
    const fallbackUserId = [...this.activeUsers.entries()].find(
      ([, socketId]) => socketId === client.id,
    )?.[0];

    if (fallbackUserId) {
      this.activeUsers.delete(fallbackUserId);
      this.logger.log(
        `WS user ${fallbackUserId} (${clientApp}) disconnected via fallback`,
      );
    }
  }

  private getClientApp(client: Socket): ClientApp {
    const fromAuth = client.handshake.auth?.clientApp;
    const fromQuery = client.handshake.query?.clientApp;
    const appName = (fromAuth || fromQuery || '').toString().toLowerCase();

    if (appName === 'zoom' || appName === 'whatsapp') {
      return appName;
    }

    return 'unknown';
  }

  // Note: No explicit join handler needed - user is automatically joined to their room
  // during connection based on authenticated token. This keeps it simpler and more secure.
  emitToUser(
    userId: string,
    payload: {
      phoneNumber: string;
      textBody?: string;
      displayText?: string;
      direction: 'inbound' | 'outbound';
      createdAt?: string;
      messageFormat?: 'text' | 'template' | 'media';
      mimeType?: string;
      mediaUrl?: string;
      templateComponents?: any[];
      status?: string;
      _id?: string;
    },
  ) {
    const room = `user:${String(userId)}`;
    this.server.to(room).emit('chat-message', {
      ...payload,
      createdAt: payload.createdAt ?? new Date().toISOString(),
    });
  }

  emitZoomRealtimeEvent(userId: string, payload: ZoomRealtimePayload) {
    const room = `user:${String(userId)}`;
    this.server.to(room).emit('zoom-update', {
      ...payload,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    });
  }

  emitZoomRegistrantsUpdate(
    userId: string,
    payload: ZoomRegistrantsUpdatePayload,
  ) {
    const room = `user:${String(userId)}`;
    this.server.to(room).emit('zoom-registrants-update', {
      ...payload,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    });
  }

  emitZoomLiveUpdate(userId: string, payload: ZoomLiveUpdatePayload) {
    const room = `user:${String(userId)}`;
    this.server.to(room).emit('zoom-live-update', {
      ...payload,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    });
  }
}
