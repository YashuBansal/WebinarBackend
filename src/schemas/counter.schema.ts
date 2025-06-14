import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema() 
export class Counter extends Document {
  @Prop({ type: String, required: true, unique: true, index: true })
  name: string;

  @Prop({ type: Number, default: 0 })
  sequence_value: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);