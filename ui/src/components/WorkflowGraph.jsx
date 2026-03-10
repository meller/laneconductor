import React, { useState, useEffect, useCallback } from 'react';
import { ReactFlow, Controls, Background, MarkerType, applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const DEFAULT_LANES = ['plan', 'backlog', 'implement', 'review', 'quality-gate', 'done'];

export function WorkflowGraph({ config, onNodeClick }) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);

  useEffect(() => {
    if (!config || !config.lanes) return;

    const newNodes = [];
    const newEdges = [];

    // Create a node for each standard lane + any custom ones in config
    const laneKeys = Array.from(new Set([...DEFAULT_LANES, ...Object.keys(config.lanes)]));

    laneKeys.forEach((lane, idx) => {
      const laneConfig = config.lanes[lane] || {};

      newNodes.push({
        id: lane,
        position: { x: 250 * idx, y: 150 },
        data: {
          label: (
            <div className="flex flex-col items-center">
              <div className="font-bold uppercase text-[10px] tracking-wider mb-1">{lane}</div>
              {laneConfig.parallel_limit !== undefined && (
                <div className="text-[8px] text-gray-400 mt-1">workers: {laneConfig.parallel_limit}</div>
              )}
              {laneConfig.max_retries !== undefined && (
                <div className="text-[8px] text-gray-400">retries: {laneConfig.max_retries}</div>
              )}
              {laneConfig.on_success && (
                <div className="text-[8px] text-green-400 font-bold mt-1">SUCCESS → {laneConfig.on_success}</div>
              )}
              {laneConfig.on_failure && (
                <div className="text-[8px] text-red-400 font-bold">FAILURE → {laneConfig.on_failure}</div>
              )}
            </div>
          )
        },
        style: {
          background: '#111827',
          color: '#e5e7eb',
          border: '1px solid #374151',
          borderRadius: '4px',
          width: 150,
          padding: '8px',
        }
      });

      // Parse lane:status syntax — edge target is always just the lane part
      const parseLane = (val) => val ? val.split(':')[0] : null;
      const parseStatus = (val) => val?.includes(':') ? val.split(':')[1] : null;

      const successTarget = parseLane(laneConfig.on_success);
      const successStatus = parseStatus(laneConfig.on_success);
      const failureTarget = parseLane(laneConfig.on_failure);

      if (successTarget) {
        const isSelfLoop = successTarget === lane;
        newEdges.push({
          id: `e-${lane}-success`,
          source: lane,
          target: successTarget,
          label: successStatus ? `✓ (${successStatus})` : 'success',
          type: isSelfLoop ? 'default' : 'smoothstep',
          ...(isSelfLoop && { sourceHandle: null, targetHandle: null }),
          style: { stroke: '#10b981' },
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
          labelStyle: { fill: '#10b981', fontSize: 10, fontWeight: 700 }
        });
      }

      if (failureTarget) {
        const isSelfLoop = failureTarget === lane;
        newEdges.push({
          id: `e-${lane}-failure`,
          source: lane,
          target: failureTarget,
          label: 'fail',
          type: isSelfLoop ? 'default' : 'smoothstep',
          style: { stroke: '#ef4444' },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#ef4444' },
          labelStyle: { fill: '#ef4444', fontSize: 10, fontWeight: 700 }
        });
      }
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [config]);

  const onNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  return (
    <div className="w-full h-full bg-gray-950 rounded border border-gray-800">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        fitView
        colorMode="dark"
      >
        <Background color="#374151" gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
