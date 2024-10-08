import { DiscordAPIError, RateLimitError } from '@discordjs/rest';
import { Snowflake } from 'discord-api-types/globals';
import { RESTJSONErrorCodes as ErrorCodes } from 'discord-api-types/v10';
import { StatusCodes } from 'http-status-codes';

import { Constants } from '@/constants';
import { Data } from '@/data';
import { ResponseStatus, ServiceResponse } from '@/data/models/serviceResponse';
import { Counter } from './counter';
import { MessagesQueue as Queue } from './messagesQueue';
import { Logger } from '../logger';
import { RateLimitsCache } from '../rateLimitsCache';
import { sleep } from '@/utils/common';
import { msToSec } from '@/utils/timeConversions';

/**
 * Submit message for crossposting
 * @param channelId ID of the channel
 * @param messageId ID of the message
 */
const submit = async (channelId: Snowflake, messageId: Snowflake, retries = 0) => {
  // Check if the message has reached the max retries
  if (retries >= 10) {
    return;
  }

  try {
    // Check if the channel is over the crossposts limit
    const isOverLimit = await Counter.isOverLimit(channelId);
    if (isOverLimit) return;

    // Crosspost the message & increment the counter for the channel
    await Data.API.Discord.crosspost(channelId, messageId);
    await Counter.increment(channelId);

    Logger.debug(`Crossposted message ${messageId} in channel ${channelId}`);
  } catch (error: DiscordAPIError | RateLimitError | unknown) {
    // Handle Discord rate limit errors
    if (error instanceof RateLimitError) {
      // Add the rate limit to the cache
      // Shared rate limits are not counted against the bot
      if (error.scope !== 'shared') {
        RateLimitsCache.add(429);
      }

      // Pause the global queue if the rate limit is global
      if (error.global) {
        Queue.pause(error.retryAfter);
      }

      // Handle non-sublimit rate limits
      if (error.sublimitTimeout === 0) {
        await sleep(error.retryAfter);
        Queue.add(channelId, messageId, retries + 1);
        return;
      }

      // Set the crossposts counter for the channel with the sublimit
      Counter.set(channelId, {
        count: 10,
        expiry: Math.ceil(msToSec(error.sublimitTimeout)) || undefined,
      });

      return;
    }

    // Handle Discord API errors
    if (error instanceof DiscordAPIError) {
      const code = typeof error.code === 'string' ? parseInt(error.code) : error.code;

      // Cache the invalid request status codes
      if (Constants.API.Discord.invalidRequestCodes.includes(error.status)) {
        RateLimitsCache.add(error.status);
      }

      // Increment the counter if the message was already crossposted
      if (code === ErrorCodes.ThisMessageWasAlreadyCrossposted) {
        Counter.increment(channelId);
      }

      // Check if the error code is safe to ignore
      if (Constants.API.Discord.safeErrorCodes.crosspost.includes(code)) {
        return;
      }
    }

    // Log the error if it's not handled above
    Logger.error(error);
  }
};

/**
 * Push message to crosspost queue
 * @param channelId ID of the channel
 * @param messageId ID of the message
 * @returns ServiceResponse
 */
const push = async (channelId: Snowflake, messageId: Snowflake) => {
  try {
    Queue.add(channelId, messageId);

    Logger.debug(`Message ${messageId} pushed to crosspost queue`);

    return new ServiceResponse(
      ResponseStatus.Success,
      'Message pushed to crosspost queue',
      {
        pushed: true,
      },
      StatusCodes.OK
    );
  } catch (error) {
    Logger.error(error);

    return new ServiceResponse(
      ResponseStatus.Failed,
      'Error pushing message to crosspost queue',
      {
        pushed: false,
      },
      StatusCodes.INTERNAL_SERVER_ERROR
    );
  }
};

export const Handler = {
  push,
  submit,
};
