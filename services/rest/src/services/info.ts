import { StatusCodes } from 'http-status-codes';

import { ResponseStatus, ServiceResponse } from '@/data/models/serviceResponse';

import { Logger } from './logger';
import { RateLimitsCache } from './rateLimitsCache';
import { MessagesQueue as Queue } from './crosspost/messagesQueue';

/**
 * Get info about the crosspost service
 */
const get = async () => {
  try {
    const info = Queue.getInfo();
    const rateLimitsSize = await RateLimitsCache.getSize();

    return new ServiceResponse(
      ResponseStatus.Success,
      'Info',
      {
        ...info,
        rateLimitsSize,
      },
      StatusCodes.OK
    );
  } catch (error) {
    Logger.error(error);

    return new ServiceResponse(ResponseStatus.Failed, 'Error getting info', null, StatusCodes.INTERNAL_SERVER_ERROR);
  }
};

export const Info = {
  get,
};
