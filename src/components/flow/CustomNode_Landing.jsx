import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';

function CustomNode({ data }) {
  return (
    <div className="px-4 py-2 border-2 border-stone-300 shadow-sm rounded-xl bg-[#ffffffa6] hover:bg-slate-50 active:bg-slate-200 active:ring">
      <div className="flex">
        <div className="rounded-full w-9 h-9 flex justify-center text-2xl items-center bg-slate-100">
          {data.icon}
        </div>
        <div className="ml-4 content-center">
          <div className="text-sky-700 text-base font-semibold">{data.label}</div>
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!h-4 !bg-sky-500 !rounded"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-4 !bg-sky-500 !rounded"
      />
    </div>
  );
}

export default memo(CustomNode);
