import mongoose, { Schema, Document } from 'mongoose';

export interface IBooking {
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  date: Date;
  time?: string;
  duration?: number;
  type?: string;
  notes?: string;
  status: 'confirmed' | 'pending' | 'cancelled' | 'completed';
  sessionId?: string;
  location?: string;
  gcalLink?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type BookingDocument = IBooking & Document;

const BookingSchema = new Schema(
  {
    clientName: { type: String, required: true },
    clientPhone: { type: String, required: true },
    clientEmail: { type: String },
    date: { type: Date, required: true, index: true },
    time: { type: String },
    duration: { type: Number, default: 60 },
    type: { type: String, default: 'Consultation' },
    notes: { type: String },
    status: {
      type: String,
      enum: ['confirmed', 'pending', 'cancelled', 'completed'],
      default: 'confirmed',
    },
    sessionId: { type: String, index: true },
    location: { type: String },
    gcalLink: { type: String },
  },
  { timestamps: true },
);

const Booking = (mongoose as any).model('Booking', BookingSchema);

export default Booking;
