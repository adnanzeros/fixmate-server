// server/utils/constants.js
export const CATEGORIES = [
  'Smartphone',
  'Laptop & PC',
  'AC',
  'Refrigerator',
  'TV',
  'Washing Machine',
  'Electrical',
];

export const SERVICE_MODES = ['Home Visit', 'Shop Drop-off'];
export const ROLES = ['customer', 'technician', 'admin'];
export const ACTIVE_STATUSES = ['requested', 'accepted', 'in-progress'];
export const BOOKING_STATUSES = [
  'requested',
  'accepted',
  'rejected',
  'in-progress',
  'completed',
  'cancelled',
];

/** Job status pipeline: current status -> statuses the technician may set next */
export const TECHNICIAN_TRANSITIONS = {
  requested: ['accepted', 'rejected'],
  accepted: ['in-progress'],
  'in-progress': ['completed'],
};
