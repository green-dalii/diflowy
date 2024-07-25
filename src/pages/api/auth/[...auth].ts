import { Auth } from "@auth/core";
import authConfig from 'auth:config'

export const GET = async (context: any) => {
  return await Auth(context.request, authConfig);
};

export const POST = async (context: any) => {
  return await Auth(context.request, authConfig);
};

// export const all = async (context: any) => {
//     return await Auth(context.request, authConfig);
//   };