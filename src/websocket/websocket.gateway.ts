import { Logger, UseFilters } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WebsocketExceptionFilter } from './ws-exception.filter';
import { SocketEvents } from './dto/socket.dto';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
@UseFilters(new WebsocketExceptionFilter())
export class WebsocketGateway {
  private readonly logger = new Logger(WebsocketGateway.name);
  public activeUsers = new Map<string, string>(); // Map to store userId -> socketId

  onModuleInit() {
    this.logger.log('------------ instance --------------');
  }

  @WebSocketServer()
  public server: Server;

  handleConnection(client: any) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  @SubscribeMessage('join')
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { user: string },
  ) {
    // console.log(data);
    if (data?.user) {
      this.activeUsers.set(data.user, client.id);
      console.log('active users', this.activeUsers);
      this.logger.log(`User ${data.user} connected with socketId ${client.id}`);
    } else {
      client.disconnect(); // Disconnect if userId is invalid
    }
  }

  handleDisconnect(client: any) {
    const userId = [...this.activeUsers.entries()].find(
      ([, socketId]) => socketId === client.id,
    )?.[0];

    if (userId) {
      this.activeUsers.delete(userId);
      // console.log('active users', this.activeUsers);
      this.logger.log(`User ${userId} disconnected`);
    }
  }

  emitSocketEvent(recipientId: string, event: SocketEvents, data: any) {
    const socketId = this.activeUsers.get(String(recipientId));
    if (socketId) {
      this.server.to(socketId).emit(event, data);
    } else {
      this.logger.warn(
        `Socket ID not found for user ${recipientId}. Event: ${event}`,
      );
    }
  }
}
