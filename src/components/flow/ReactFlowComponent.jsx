import { useCallback, useState } from 'react';
import { ReactFlow, applyEdgeChanges, applyNodeChanges, Background } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../../styles/workflow.css'

const initialNodes = [
    {
        id: '1',
        type: 'input',
        data: { label: <div style={{display:"flex", justifyContent:"center"}}><img src="dify.png" style={{maxHeight: "2em"}}/></div> },
        position: { x: 130, y: 120 },
        justify: 'center',
        align: 'center',
        sourcePosition: 'right',
        targetPosition: 'left',
    },

    {
        id: '2',
        type: 'input',
        // you can also pass a React component as a label
        data: { label: <div>WorkFlow</div> },
        position: { x: 270, y: 190 },
        sourcePosition: 'right',
        targetPosition: 'left',
    },
    {
        id: '3',
        type: 'output',
        data: { label: <div style={{display:"flex", justifyContent:"center"}}><img src="brand.svg" style={{maxHeight: "2em"}}/></div> },
        position: { x: 200, y: 300 },
        sourcePosition: 'right',
        targetPosition: 'left',
    },
];

const initialEdges = [
    { id: 'e1-2', source: '1', target: '3', animated: true },
    { id: 'e2-3', source: '2', target: '3', animated: true },
];

const ReactFlowComponent = () => {
    const [nodes, setNodes] = useState(initialNodes);
    const [edges, setEdges] = useState(initialEdges);

    const onNodesChange = useCallback(
        (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
        [setNodes],
    );
    const onEdgesChange = useCallback(
        (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
        [setEdges],
    );
    return (
        <div style={{ height: 500 }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                zoomOnScroll={false}
                panOnDrag={false}
                fitView >
                <Background />
            </ReactFlow>
        </div>
    );
};

export default ReactFlowComponent;