import type { TransportLike } from '../types.js';

export type DeliveryTransports = {
  emailSmtp?: TransportLike;
  slack?: TransportLike;
};
