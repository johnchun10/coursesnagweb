export const config = {
  tableName: process.env.TABLE_NAME || '',
  alertQueueUrl: process.env.ALERT_QUEUE_URL || '',
  modeParameterName: process.env.MODE_PARAMETER_NAME || '',
  discordBotTokenParameter: process.env.DISCORD_BOT_TOKEN_PARAMETER || '',
  discordClientSecretParameter: process.env.DISCORD_CLIENT_SECRET_PARAMETER || '',
  discordApplicationId: process.env.DISCORD_APPLICATION_ID || '',
  discordPublicKey: process.env.DISCORD_PUBLIC_KEY || '',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'https://coursesnag.pages.dev',
  stageName: process.env.STAGE_NAME || 'dev',
  cornellApiBase: process.env.CORNELL_API_BASE || 'https://classes.cornell.edu/api/2.0'
};

export function requireConfig(...keys) {
  for (const key of keys) {
    if (!config[key]) {
      throw new Error(`Missing required configuration: ${key}`);
    }
  }
}
