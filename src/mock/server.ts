import { isIP } from 'node:net';
import type { Server } from 'node:http';

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import express, { type Express } from 'express';

import { healthcheckSchema, type HealthcheckPayload } from './healthcheck-schema';

const DEFAULT_PORT = 3001;
const DEFAULT_HOST = '127.0.0.1';
const HEALTHCHECK_PATH = '/api/v1/healthcheck';

type StartServerOptions = {
  host?: string;
  port?: number;
  silent?: boolean;
};

function isValidIpAddress(value: string): boolean {
  const zoneSeparator = value.indexOf('%');

  if (zoneSeparator === -1) {
    return isIP(value) !== 0;
  }

  const address = value.slice(0, zoneSeparator);
  const zoneIndex = value.slice(zoneSeparator + 1);
  const hasOneZoneSeparator = value.indexOf('%', zoneSeparator + 1) === -1;
  const hasValidZoneIndex = /^[A-Za-z0-9_.~-]+$/.test(zoneIndex);

  return hasOneZoneSeparator && hasValidZoneIndex && isIP(address) === 6;
}

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addFormat('ip-address', {
  type: 'string',
  validate: isValidIpAddress,
});

const validateHealthcheck = ajv.compile<HealthcheckPayload>(healthcheckSchema);

export function createHealthcheckApp(): Express {
  const app = express();
  app.use(express.json());

  app.post(HEALTHCHECK_PATH, (request, response) => {
    if (validateHealthcheck(request.body)) {
      return response.status(200).json({ status: 'ok' });
    }

    return response.status(400).json({
      status: 'error',
      errors: validateHealthcheck.errors ?? [],
    });
  });

  return app;
}

export async function startHealthcheckServer({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  silent = false,
}: StartServerOptions = {}): Promise<Server> {
  const app = createHealthcheckApp();

  return new Promise((resolveServer, rejectServer) => {
    const server = app.listen(port, host);

    const handleError = (error: Error) => {
      rejectServer(error);
    };

    server.once('error', handleError);
    server.once('listening', () => {
      server.off('error', handleError);

      if (!silent) {
        const address = server.address();
        const listeningPort =
          address && typeof address !== 'string' ? address.port : port;
        console.log(`Healthcheck mock listening on http://${host}:${listeningPort}`);
      }

      resolveServer(server);
    });
  });
}

function readConfiguredPort(): number {
  const configuredPort = process.env.MOCK_PORT;

  if (configuredPort === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(configuredPort);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('MOCK_PORT must be an integer between 1 and 65535.');
  }

  return port;
}

if (require.main === module) {
  startHealthcheckServer({ port: readConfiguredPort() }).catch((error: unknown) => {
    console.error('Healthcheck mock failed to start.', error);
    process.exitCode = 1;
  });
}
