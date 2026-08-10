import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { config, requireConfig } from './config.mjs';

const ssm = new SSMClient({});

export async function currentMode() {
  requireConfig('modeParameterName');
  const result = await ssm.send(new GetParameterCommand({
    Name: config.modeParameterName
  }));
  return result.Parameter?.Value || 'local';
}

export function cloudMonitoringIsActive(mode) {
  return mode === 'cloud';
}
