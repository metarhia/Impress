'use strict';

// V8 internal functions for Impress Application Server

/* jshint ignore:start */

api.v8.getOptimizationStatus = fn => %GetOptimizationStatus(fn);
api.v8.getOptimizationCount = fn => %GetOptimizationCount(fn);
api.v8.optimizeFunctionOnNextCall = fn => %OptimizeFunctionOnNextCall(fn);
api.v8.deoptimizeFunction = fn => %DeoptimizeFunction(fn);
api.v8.clearFunctionTypeFeedback = fn => %ClearFunctionTypeFeedback(fn);
api.v8.debugPrint = data => %DebugPrint(data);
api.v8.collectGarbage = () => %CollectGarbage(null);
api.v8.getHeapUsage = () => %GetHeapUsage();
api.v8.hasFastProperties = data => %HasFastProperties(data);
api.v8.hasFastSmiElements = data => %HasFastSmiElements(data);
api.v8.hasFastObjectElements = data => %HasFastObjectElements(data);
api.v8.hasFastDoubleElements = data => %HasFastDoubleElements(data);
api.v8.hasDictionaryElements = data => %HasDictionaryElements(data);
api.v8.hasFastHoleyElements = data => %HasFastHoleyElements(data);
api.v8.hasFastSmiOrObjectElements = data => %HasFastSmiOrObjectElements(data);
api.v8.hasSloppyArgumentsElements = data => %HasSloppyArgumentsElements(data);
api.v8.functionGetName = fn => %FunctionGetName(fn);
api.v8.getV8Version = () => %GetV8Version();

/* jshint ignore:end */

api.v8.isInPrototypeChain = (value, proto) => (
  value.isPrototypeOf(Object.getPrototypeOf(proto))
);

api.v8.OPT_STATUS = [
  /*0*/ 'unknown',
  /*1*/ 'optimized',
  /*2*/ 'not optimized',
  /*3*/ 'always optimized',
  /*4*/ 'never optimized',
  /*5*/ 'unknown',
  /*6*/ 'maybe deoptimized',
  /*7*/ 'turbofan optimized'
];

api.v8.optimizationStatus = status => api.v8.OPT_STATUS[status];

api.v8.getOptimizationToString = (fn) => {
  const status = api.v8.getOptimizationStatus(fn);
  return api.v8.optimizationStatus(status);
};
