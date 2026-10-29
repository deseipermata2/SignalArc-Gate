import { handleApi } from '../../server/sg03/api'

export const onRequest: PagesFunction<Record<string, unknown>> = ({
  request,
  env,
}) => handleApi(request, env)
