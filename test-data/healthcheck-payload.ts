import type { HealthcheckPayload } from '../src/mock/healthcheck-schema';

const baseHealthcheckPayload: HealthcheckPayload = {
  agent_id: 'BF5B45B4-FF6C-8090-E4B6-DBAED562574D',
  base_board_sn: 'None',
  computer_name: 'VM11',
  system_product_uuid: '4A114D56-62E0-8B0B-594A-6618D15F8385',
  os_name: 'Windows 11 Pro',
  os_major: 10,
  os_minor: 0,
  os_build: 22_000,
  last_boot_time: '2022-07-16T20:53:27Z',
  last_update_time: '2022-09-13T09:43:46Z',
  adapter_info: [
    {
      addresses: ['192.168.195.150'],
      name: 'Ethernet',
    },
  ],
  session_info: [
    {
      account_name: '',
      account_sid: '',
      host_name: '',
      session_id: 0,
      session_name: 'Services',
      state: 'Disconnected',
    },
  ],
  roles: ['workstation'],
};

export function createValidHealthcheckPayload(
  overrides: Partial<HealthcheckPayload> = {},
): HealthcheckPayload {
  return {
    ...baseHealthcheckPayload,
    adapter_info: baseHealthcheckPayload.adapter_info.map((adapter) => ({
      ...adapter,
      addresses: [...adapter.addresses],
    })),
    session_info: baseHealthcheckPayload.session_info.map((session) => ({
      ...session,
    })),
    roles: [...baseHealthcheckPayload.roles],
    ...overrides,
  };
}
