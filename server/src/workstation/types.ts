export interface Workstation {
  id: number;
  name: string;
  hostname: string;
  ip: string;
  mac_address: string;
  vnc_port: number;
  location: string | null;
  description: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkstationInput {
  name: string;
  hostname: string;
  ip: string;
  mac_address: string;
  vnc_port: number;
  location: string | null;
  description: string | null;
  enabled: boolean;
}

export type WorkstationUpdateInput = Partial<WorkstationInput>;
